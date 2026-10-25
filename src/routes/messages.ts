// 1:1 chat (web: messages.index.tsx and messages.$threadId.tsx).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";
import { messageToFileUrls } from "../media/inline";
import { publicBase } from "./uploads";

const threadParam = z.object({ id: z.string().uuid() });
const MESSAGE_COLUMNS = "id, thread_id, sender_id, content, read_at, created_at";

export const messageRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Inbox: newest first, with the other person, unread count and a light preview.
  // Previews are built here because product/attachment messages can hold whole images (MBs).
  .get("/threads", async (c) => {
    const claims = c.get("claims")!;
    const rows = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT t.id, t.last_message_at,
           json_build_object('id', o.id, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url) AS other,
           CASE
             WHEN t.last_message IS NULL THEN NULL
             WHEN t.last_message LIKE '\\_\\_REF\\_\\_:%' THEN json_build_object('type', 'ref',
               'kind', substring(t.last_message from '"kind":"([a-z]+)"'),
               'title', substring(t.last_message from '"title":"([^"]*)"'))
             WHEN t.last_message LIKE '\\_\\_ATT\\_\\_:%' THEN json_build_object('type', 'att')
             ELSE json_build_object('type', 'text', 'text', left(t.last_message, 200))
           END AS preview,
           (SELECT count(*)::int FROM public.messages m
            WHERE m.thread_id = t.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
         FROM public.message_threads t
         CROSS JOIN LATERAL (SELECT CASE WHEN t.participant_a = $1 THEN t.participant_b ELSE t.participant_a END AS id) o
         LEFT JOIN public.profiles pr ON pr.id = o.id
         WHERE (t.participant_a = $1 OR t.participant_b = $1)
           -- chats this user deleted stay hidden until a newer message arrives
           AND NOT EXISTS (SELECT 1 FROM public.message_thread_hides h
                           WHERE h.thread_id = t.id AND h.user_id = $1 AND h.hidden_at >= t.last_message_at)
         ORDER BY t.last_message_at DESC`,
        [claims.sub],
      );
      return rows;
    });
    return c.json(rows);
  })

  // Open (or create) the 1:1 chat with another user. Participants are stored sorted, as on the web.
  .post("/threads", zValidator("json", z.object({ otherUserId: z.string().uuid(), storeId: z.string().uuid().optional() })), async (c) => {
    const claims = c.get("claims")!;
    const { otherUserId, storeId } = c.req.valid("json");
    if (otherUserId === claims.sub) throw new HTTPException(400, { message: "self_chat" });
    const [a, b] = [claims.sub, otherUserId].sort();
    const threadId = await asUser(claims, async (_db, tx) => {
      const existing = await tx.query<{ id: string }>("SELECT id FROM public.message_threads WHERE participant_a = $1 AND participant_b = $2", [a, b]);
      const id =
        existing.rows[0]?.id ??
        (await tx.query<{ id: string }>("INSERT INTO public.message_threads (participant_a, participant_b) VALUES ($1, $2) RETURNING id", [a, b])).rows[0].id;
      if (storeId) await tx.query("SELECT public.increment_supplier_contact($1)", [storeId]);
      return id;
    });
    return c.json({ threadId });
  })

  // The thread, the other person and its messages (oldest first). `after` returns only newer ones (polling).
  .get(
    "/threads/:id",
    zValidator("param", threadParam),
    zValidator("query", z.object({ after: z.string().datetime({ offset: true }).optional() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { after } = c.req.valid("query");
      const data = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query(
          `SELECT t.id, t.pinned_post_id,
             json_build_object('id', o.id, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url) AS other,
             -- The other person's approved shop, shown in the chat header instead of their profile (web, 2026-10)
             (SELECT json_build_object('id', s.id, 'name', s.name, 'logo_url', s.logo_url) FROM public.supplier_stores s
              WHERE s.user_id = o.id AND s.status = 'approved' ORDER BY s.created_at DESC LIMIT 1) AS store
           FROM public.message_threads t
           CROSS JOIN LATERAL (SELECT CASE WHEN t.participant_a = $2 THEN t.participant_b ELSE t.participant_a END AS id) o
           LEFT JOIN public.profiles pr ON pr.id = o.id
           WHERE t.id = $1`,
          [id, claims.sub],
        );
        if (!rows[0]) return null;
        const messages = after
          ? // Clients only see milliseconds; compare at that precision so the last message isn't returned again.
            await tx.query(
              `SELECT ${MESSAGE_COLUMNS} FROM public.messages WHERE thread_id = $1 AND date_trunc('milliseconds', created_at) > $2 ORDER BY created_at`,
              [id, after],
            )
          : await tx.query(`SELECT ${MESSAGE_COLUMNS} FROM public.messages WHERE thread_id = $1 ORDER BY created_at`, [id]);
        // Read receipts for my own messages, so ✓ can become ✓✓ while polling.
        const readIds = after
          ? (
              await tx.query<{ id: string }>(
                "SELECT id FROM public.messages WHERE thread_id = $1 AND sender_id = $2 AND read_at IS NOT NULL ORDER BY created_at DESC LIMIT 50",
                [id, claims.sub],
              )
            ).rows.map((r) => r.id)
          : undefined;
        return { thread: rows[0], messages: messages.rows, readIds };
      });
      if (!data) throw new HTTPException(404, { message: "not_found" });
      return c.json(data);
    },
  )

  // The item a chat is about: ?pin=post:<id> | rental:<id> | listing:<id> | store:<id>, else the thread's pinned post.
  .get("/threads/:id/pinned", zValidator("param", threadParam), zValidator("query", z.object({ pin: z.string().optional() })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const [kind, pinId] = (c.req.valid("query").pin ?? "").split(":");
    const valid = z.string().uuid().safeParse(pinId).success;
    const pinned = await asUser(claims, async (_db, tx) => {
      if (kind === "store" && valid) {
        const { rows } = await tx.query(
          `SELECT id, 'store' AS kind, '/suppliers/' || id AS href, name AS title, description AS content, NULL::float8 AS price,
             NULL::float8 AS discount_price, 'USD' AS currency, 'store' AS post_type, logo_url AS photo_url
           FROM public.supplier_stores WHERE id = $1`,
          [pinId],
        );
        return rows[0] ?? null;
      }
      if (kind === "rental" && valid) {
        const { rows } = await tx.query(
          `SELECT id, 'rental' AS kind, '/rentals/' || id AS href, title, description AS content, price_per_day::float8 AS price,
             NULL::float8 AS discount_price, COALESCE(currency, 'USD') AS currency, 'rental' AS post_type,
             (SELECT photo_url FROM public.rental_photos WHERE listing_id = r.id ORDER BY created_at LIMIT 1) AS photo_url
           FROM public.rental_listings r WHERE id = $1`,
          [pinId],
        );
        return rows[0] ?? null;
      }
      if (kind === "listing" && valid) {
        const { rows } = await tx.query(
          `SELECT id, 'listing' AS kind, '/listings/' || id AS href, title, description AS content, budget::float8 AS price,
             NULL::float8 AS discount_price, 'USD' AS currency, 'listing' AS post_type,
             (SELECT photo_url FROM public.listing_photos WHERE listing_id = l.id ORDER BY created_at LIMIT 1) AS photo_url
           FROM public.listings l WHERE id = $1`,
          [pinId],
        );
        return rows[0] ?? null;
      }
      let postId = kind === "post" && valid ? pinId : null;
      if (!postId) {
        const t = await tx.query<{ pinned_post_id: string | null }>("SELECT pinned_post_id FROM public.message_threads WHERE id = $1", [id]);
        postId = t.rows[0]?.pinned_post_id ?? null;
      }
      if (!postId) return null;
      const { rows } = await tx.query(
        `SELECT id, 'post' AS kind, '/home?post=' || id AS href, title, content, price::float8 AS price,
           discount_price::float8 AS discount_price, COALESCE(currency, 'USD') AS currency, post_type,
           (SELECT photo_url FROM public.post_photos WHERE post_id = p.id ORDER BY created_at LIMIT 1) AS photo_url
         FROM public.posts p WHERE id = $1`,
        [postId],
      );
      return rows[0] ?? null;
    });
    return c.json(pinned);
  })

  .post(
    "/threads/:id/messages",
    zValidator("param", threadParam),
    // Attachments come inline as data URLs (same format as the web), so allow large bodies.
    // Images are saved as files and the message keeps only the link.
    zValidator("json", z.object({ content: z.string().min(1).max(8_000_000) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const content = await messageToFileUrls(c.req.valid("json").content, publicBase(c.req.url));
      const row = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query(
          `INSERT INTO public.messages (thread_id, sender_id, content) VALUES ($1, $2, $3) RETURNING ${MESSAGE_COLUMNS}`,
          [id, claims.sub, content],
        );
        return rows[0];
      });
      return c.json(row, 201);
    },
  )

  .post("/threads/:id/read", zValidator("param", threadParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) =>
      (
        await tx.query("UPDATE public.messages SET read_at = now() WHERE thread_id = $1 AND sender_id <> $2 AND read_at IS NULL", [id, claims.sub])
      ).rowCount,
    );
    return c.json({ marked: n });
  })

  // "Delete chat" (app only, not on the web): hides it from this user's inbox and marks it read.
  // Messages are kept for the other person; a newer message brings the chat back.
  .post("/threads/:id/hide", zValidator("param", threadParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    await asUser(claims, async (_db, tx) => {
      // RLS on message_thread_hides refuses threads this user isn't in
      await tx.query(
        `INSERT INTO public.message_thread_hides (user_id, thread_id) VALUES ($2, $1)
         ON CONFLICT (user_id, thread_id) DO UPDATE SET hidden_at = now()`,
        [id, claims.sub],
      );
      await tx.query("UPDATE public.messages SET read_at = now() WHERE thread_id = $1 AND sender_id <> $2 AND read_at IS NULL", [id, claims.sub]);
    });
    return c.json({ ok: true });
  });
