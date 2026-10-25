// Comments on posts and rentals (web: CommentsSheet.tsx and RentalCommentsSheet.tsx).
// Both use the same shape, only the tables differ.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

const TABLES = {
  post: { comments: "post_comments", target: "post_id", likes: "comment_likes" },
  rental: { comments: "rental_comments", target: "rental_id", likes: "rental_comment_likes" },
} as const;

const kindParam = z.object({ kind: z.enum(["post", "rental"]), id: z.string().uuid() });

const COMMENT_COLUMNS = (alias: string) => `
  ${alias}.id, ${alias}.content, ${alias}.created_at, ${alias}.user_id, ${alias}.parent_id,
  (SELECT json_build_object('full_name', pr.full_name, 'avatar_url', pr.avatar_url)
   FROM public.profiles pr WHERE pr.id = ${alias}.user_id) AS profiles`;

export const commentRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // All comments of a post/rental (oldest first) plus like counts.
  .get("/:kind/:id", zValidator("param", kindParam), async (c) => {
    const claims = c.get("claims")!;
    const { kind, id } = c.req.valid("param");
    const tb = TABLES[kind];
    const data = await asUser(claims, async (_db, tx) => {
      const { rows: comments } = await tx.query(
        `SELECT ${COMMENT_COLUMNS("c")} FROM public.${tb.comments} c WHERE c.${tb.target} = $1 ORDER BY c.created_at ASC`,
        [id],
      );
      const likes: Record<string, { count: number; mine: boolean }> = {};
      for (const row of comments) likes[row.id] = { count: 0, mine: false };
      if (comments.length) {
        const { rows } = await tx.query<{ comment_id: string; n: number; mine: boolean }>(
          `SELECT comment_id, count(*)::int AS n, bool_or(user_id = $2) AS mine FROM public.${tb.likes} WHERE comment_id = ANY($1) GROUP BY 1`,
          [comments.map((r) => r.id), claims.sub],
        );
        for (const r of rows) likes[r.comment_id] = { count: r.n, mine: r.mine };
      }
      return { comments, likes };
    });
    return c.json(data);
  })

  .post(
    "/:kind/:id",
    zValidator("param", kindParam),
    zValidator("json", z.object({ content: z.string().trim().min(1).max(5000), parentId: z.string().uuid().nullable().optional() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { kind, id } = c.req.valid("param");
      const { content, parentId } = c.req.valid("json");
      const tb = TABLES[kind];
      const row = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query(
          `WITH ins AS (
             INSERT INTO public.${tb.comments} (${tb.target}, user_id, content, parent_id) VALUES ($1, $2, $3, $4) RETURNING *
           ) SELECT ${COMMENT_COLUMNS("ins")} FROM ins`,
          [id, claims.sub, content, parentId ?? null],
        );
        return rows[0];
      });
      return c.json(row, 201);
    },
  )

  .patch(
    "/:kind/c/:id",
    zValidator("param", kindParam),
    zValidator("json", z.object({ content: z.string().trim().min(1).max(5000) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { kind, id } = c.req.valid("param");
      const n = await asUser(claims, async (_db, tx) =>
        (await tx.query(`UPDATE public.${TABLES[kind].comments} SET content = $2 WHERE id = $1`, [id, c.req.valid("json").content])).rowCount,
      );
      if (!n) throw new HTTPException(403, { message: "forbidden" });
      return c.json({ ok: true });
    },
  )

  .delete("/:kind/c/:id", zValidator("param", kindParam), async (c) => {
    const claims = c.get("claims")!;
    const { kind, id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) => (await tx.query(`DELETE FROM public.${TABLES[kind].comments} WHERE id = $1`, [id])).rowCount);
    if (!n) throw new HTTPException(403, { message: "forbidden" });
    return c.json({ ok: true });
  })

  .put("/:kind/c/:id/like", zValidator("param", kindParam), zValidator("json", z.object({ liked: z.boolean() })), async (c) => {
    const claims = c.get("claims")!;
    const { kind, id } = c.req.valid("param");
    const table = TABLES[kind].likes;
    await asUser(claims, async (_db, tx) => {
      if (c.req.valid("json").liked) {
        const exists = await tx.query(`SELECT 1 FROM public.${table} WHERE comment_id = $1 AND user_id = $2`, [id, claims.sub]);
        if (!exists.rowCount) await tx.query(`INSERT INTO public.${table} (comment_id, user_id) VALUES ($1, $2)`, [id, claims.sub]);
      } else {
        await tx.query(`DELETE FROM public.${table} WHERE comment_id = $1 AND user_id = $2`, [id, claims.sub]);
      }
    });
    return c.json({ ok: true });
  });
