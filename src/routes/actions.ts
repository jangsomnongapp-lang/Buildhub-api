// Small user actions from the feed. Each one is the same write the web made through Supabase,
// so the RLS policies decide who may do it.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser, pool } from "../db/client";
import { optionalAuth, requireAuth, requireAuthExceptGet, type AuthEnv } from "../auth/middleware";

const uuid = z.object({ id: z.string().uuid() });

// Mounted at "/", so the auth check is scoped to these paths only.
export const actionRoutes = new Hono<AuthEnv>()
  .use("/posts", optionalAuth, requireAuth)
  // The product page is public on the web (shared links open signed out).
  .use("/posts/*", optionalAuth, requireAuthExceptGet(/^\/posts\/[^/]+\/detail$/))
  .use("/rentals/*", optionalAuth, requireAuth)
  .use("/reports", optionalAuth, requireAuth)
  .use("/stories", optionalAuth, requireAuth)
  .use("/stories/*", optionalAuth, requireAuth)

  // React to a post (null removes the reaction).
  .put(
    "/posts/:id/reaction",
    zValidator("param", uuid),
    zValidator("json", z.object({ reaction: z.enum(["like", "love", "haha", "wow", "sad"]).nullable() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { reaction } = c.req.valid("json");
      await asUser(claims, async (_db, tx) => {
        if (!reaction) {
          await tx.query("DELETE FROM public.post_likes WHERE post_id = $1 AND user_id = $2", [id, claims.sub]);
          return;
        }
        const updated = await tx.query("UPDATE public.post_likes SET reaction = $3 WHERE post_id = $1 AND user_id = $2", [id, claims.sub, reaction]);
        if (!updated.rowCount) {
          await tx.query("INSERT INTO public.post_likes (post_id, user_id, reaction) VALUES ($1, $2, $3)", [id, claims.sub, reaction]);
        }
      });
      return c.json({ ok: true });
    },
  )

  // New normal post (web: routes/announce.tsx). Saved as "pending" for admin review, as on the web.
  .post(
    "/posts",
    zValidator(
      "json",
      z.object({ content: z.string().max(5000).nullable(), videoUrl: z.string().max(1000).nullable(), photos: z.array(z.string().url()).max(20) }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      if (!b.content?.trim() && !b.photos.length && !b.videoUrl?.trim()) throw new HTTPException(400, { message: "empty post" });
      const id = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query<{ id: string }>(
          "INSERT INTO public.posts (user_id, content, video_url, status) VALUES ($1, $2, $3, 'pending') RETURNING id",
          [claims.sub, b.content?.trim() || null, b.videoUrl?.trim() || null],
        );
        if (b.photos.length) await tx.query("INSERT INTO public.post_photos (post_id, photo_url) SELECT $1, unnest($2::text[])", [rows[0].id, b.photos]);
        return rows[0].id;
      });
      return c.json({ id }, 201);
    },
  )

  .patch("/posts/:id",zValidator("param", uuid), zValidator("json", z.object({ content: z.string().trim().min(1) })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) => {
      const r = await tx.query("UPDATE public.posts SET content = $2 WHERE id = $1", [id, c.req.valid("json").content]);
      return r.rowCount;
    });
    if (!n) throw new HTTPException(403, { message: "forbidden" });
    return c.json({ ok: true });
  })

  .delete("/posts/:id", zValidator("param", uuid), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) => (await tx.query("DELETE FROM public.posts WHERE id = $1", [id])).rowCount);
    if (!n) throw new HTTPException(403, { message: "forbidden" });
    return c.json({ ok: true });
  })

  // Product page (getPublicPost): an approved post with its photos, author and approved store.
  // Public, and read with the server's own access like the web's supabaseAdmin call (approved by the
  // user 2026-10-15): anonymous visitors can't read posts under RLS. Only approved posts and these columns.
  .get("/posts/:id/detail", zValidator("param", uuid), async (c) => {
    const { id } = c.req.valid("param");
    const { rows } = await pool.query(
      `SELECT p.id, p.user_id, p.content, p.title, p.price::float8 AS price, p.discount_price::float8 AS discount_price,
              p.currency, p.post_type, p.created_at, p.view_count,
              COALESCE((SELECT json_agg(json_build_object('photo_url', ph.photo_url) ORDER BY ph.created_at)
                        FROM public.post_photos ph WHERE ph.post_id = p.id), '[]') AS post_photos,
              (SELECT json_build_object('full_name', pr.full_name, 'avatar_url', pr.avatar_url)
               FROM public.profiles pr WHERE pr.id = p.user_id) AS profiles,
              (SELECT json_build_object('id', s.id, 'name', s.name, 'logo_url', s.logo_url)
               FROM public.supplier_stores s WHERE s.user_id = p.user_id AND s.status = 'approved' LIMIT 1) AS store
       FROM public.posts p WHERE p.id = $1 AND p.status = 'approved'`,
      [id],
    );
    const post = rows[0];
    if (!post) return c.json({ error: "not_found" }, 404);
    return c.json({ ...post, currency: post.currency ?? "USD", view_count: post.view_count ?? 0 });
  })

  // The web bumps view_count from the browser; RLS only lets the owner or an admin update, so most views don't count.
  .post("/posts/:id/view", zValidator("param", uuid), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    await asUser(claims, (_db, tx) =>
      tx.query("UPDATE public.posts SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1 AND user_id <> $2", [id, claims.sub]),
    ).catch(() => undefined);
    return c.json({ ok: true });
  })

  // "Ask now": open/create the product chat with the post's author.
  .post("/posts/:id/chat", zValidator("param", uuid), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const threadId = await asUser(claims, async (_db, tx) => {
      const p = await tx.query<{ user_id: string }>("SELECT user_id FROM public.posts WHERE id = $1", [id]);
      if (!p.rows[0]) throw new HTTPException(404, { message: "not_found" });
      const { rows } = await tx.query<{ id: string }>("SELECT public.start_product_chat($1, $2) AS id", [p.rows[0].user_id, id]);
      return rows[0]?.id;
    });
    if (!threadId) throw new HTTPException(500, { message: "No thread" });
    return c.json({ threadId });
  })

  .put("/rentals/:id/like", zValidator("param", uuid), zValidator("json", z.object({ liked: z.boolean() })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    await asUser(claims, async (_db, tx) => {
      if (c.req.valid("json").liked) {
        const exists = await tx.query("SELECT 1 FROM public.rental_likes WHERE rental_id = $1 AND user_id = $2", [id, claims.sub]);
        if (!exists.rowCount) await tx.query("INSERT INTO public.rental_likes (rental_id, user_id) VALUES ($1, $2)", [id, claims.sub]);
      } else {
        await tx.query("DELETE FROM public.rental_likes WHERE rental_id = $1 AND user_id = $2", [id, claims.sub]);
      }
    });
    return c.json({ ok: true });
  })

  .post(
    "/reports",
    zValidator(
      "json",
      z.object({ targetKind: z.enum(["post", "listing", "profile"]), targetId: z.string().uuid(), reason: z.string().max(2000).optional() }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      await asUser(claims, (_db, tx) =>
        tx.query("INSERT INTO public.reports (reporter_id, target_kind, target_id, reason) VALUES ($1, $2, $3, $4)", [
          claims.sub,
          b.targetKind,
          b.targetId,
          b.reason?.trim() || null,
        ]),
      );
      return c.json({ ok: true }, 201);
    },
  )

  // New story (web: routes/story.new.tsx): one photo and an optional caption, "pending" until an admin approves it.
  .post(
    "/stories",
    zValidator("json", z.object({ mediaUrl: z.string().url(), caption: z.string().max(120).optional() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { mediaUrl, caption } = c.req.valid("json");
      const id = await asUser(claims, async (_db, tx) =>
        (
          await tx.query<{ id: string }>(
            `INSERT INTO public.stories (user_id, media_url, media_type, caption, status) VALUES ($1, $2, 'photo', $3, 'pending') RETURNING id`,
            [claims.sub, mediaUrl, caption?.trim() || null],
          )
        ).rows[0].id,
      );
      return c.json({ id }, 201);
    },
  )

  // One user's live stories, oldest first (web: routes/story.view.tsx). For my own stories each row
  // carries its viewer count (RLS lets only the owner read story_views of a story).
  .get("/stories/user/:id", zValidator("param", uuid), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const rows = await asUser(claims, async (_db, tx) =>
      (
        await tx.query(
          `SELECT s.id, s.user_id, s.media_url, s.caption, s.created_at, s.expires_at, p.full_name, p.avatar_url,
             CASE WHEN s.user_id = $2 THEN (SELECT count(*)::int FROM public.story_views v WHERE v.story_id = s.id) END AS viewer_count
           FROM public.stories s LEFT JOIN public.profiles p ON p.id = s.user_id
           WHERE s.user_id = $1 AND s.status = 'approved' AND s.expires_at > now()
           ORDER BY s.created_at`,
          [id, claims.sub],
        )
      ).rows,
    );
    return c.json(rows);
  })

  // Who viewed my story, newest first.
  .get("/stories/:id/viewers", zValidator("param", uuid), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const rows = await asUser(claims, async (_db, tx) =>
      (
        await tx.query(
          `SELECT v.viewer_id, v.created_at, p.full_name, p.avatar_url
           FROM public.story_views v LEFT JOIN public.profiles p ON p.id = v.viewer_id
           WHERE v.story_id = $1 ORDER BY v.created_at DESC`,
          [id],
        )
      ).rows,
    );
    return c.json(rows);
  })

  // Opening someone else's story counts a view once (unique per viewer).
  .post("/stories/:id/view", zValidator("param", uuid), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    await asUser(claims, (_db, tx) =>
      tx.query(
        `INSERT INTO public.story_views (story_id, viewer_id)
         SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM public.stories WHERE id = $1 AND user_id <> $2)
         ON CONFLICT DO NOTHING`,
        [id, claims.sub],
      ),
    );
    return c.json({ ok: true });
  });
