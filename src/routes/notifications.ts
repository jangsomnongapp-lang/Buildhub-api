// Alerts page (web: routes/alerts.tsx).
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

// Tables the alert rows link to; the web checks the row still exists before opening it.
const TARGET_TABLES = { post: "posts", listing: "listings", project: "projects", user: "profiles" } as const;

export const notificationRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Latest 50, newest first, with the related user's name and avatar.
  .get("/", async (c) => {
    const claims = c.get("claims")!;
    const rows = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT n.id, n.kind, n.title, n.body, n.related_user_id, n.related_post_id, n.related_listing_id,
           n.related_project_id, n.read_at, n.created_at,
           CASE WHEN p.id IS NULL THEN NULL
             ELSE json_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url) END AS related_user
         FROM public.notifications n
         LEFT JOIN public.profiles p ON p.id = n.related_user_id
         WHERE n.user_id = $1
         ORDER BY n.created_at DESC
         LIMIT 50`,
        [claims.sub],
      );
      return rows;
    });
    return c.json(rows);
  })

  .post("/read-all", async (c) => {
    const claims = c.get("claims")!;
    await asUser(claims, (_db, tx) =>
      tx.query("UPDATE public.notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [claims.sub]),
    );
    return c.json({ ok: true });
  })

  .post("/:id/read", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    await asUser(claims, (_db, tx) =>
      tx.query("UPDATE public.notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL", [id]),
    );
    return c.json({ ok: true });
  })

  // Does the post/listing/project/user an alert points to still exist (and is visible to me)?
  .get(
    "/target/:kind/:id",
    zValidator("param", z.object({ kind: z.enum(["post", "listing", "project", "user"]), id: z.string().uuid() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { kind, id } = c.req.valid("param");
      const exists = await asUser(claims, async (_db, tx) => {
        const { rowCount } = await tx.query(`SELECT 1 FROM public.${TARGET_TABLES[kind]} WHERE id = $1`, [id]);
        return (rowCount ?? 0) > 0;
      });
      return c.json({ exists });
    },
  );
