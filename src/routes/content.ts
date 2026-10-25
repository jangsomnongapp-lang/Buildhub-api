// My content (web: routes/my-posts.tsx): my posts, rentals and jobs, with edit text / edit media / delete.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

// Each kind's table, photo table and photo foreign key (same as the web).
const KINDS = {
  post: { table: "posts", photos: "post_photos", fk: "post_id" },
  rental: { table: "rental_listings", photos: "rental_photos", fk: "listing_id" },
  project: { table: "listings", photos: "listing_photos", fk: "listing_id" },
} as const;
const target = z.object({ kind: z.enum(["post", "rental", "project"]), id: z.string().uuid() });

const photosOf = (k: keyof typeof KINDS, alias: string) =>
  `COALESCE((SELECT json_agg(json_build_object('id', ph.id, 'photo_url', ph.photo_url) ORDER BY ph.created_at)
             FROM public.${KINDS[k].photos} ph WHERE ph.${KINDS[k].fk} = ${alias}.id), '[]') AS photos`;

// Text fields per kind, as in the web's edit dialog.
const textSchemas = {
  post: z.object({ title: z.string().max(200), content: z.string().trim().min(1).max(10000) }),
  rental: z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    location: z.string().trim().min(1).max(200),
    price_per_day: z.coerce.number().nonnegative(),
    min_days: z.coerce.number().int().min(0),
  }),
  project: z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    location: z.string().max(200),
    budget: z.string().max(30),
  }),
};

export const contentRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  .get("/", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const me = [claims.sub];
      const posts = await tx.query(
        `SELECT p.id, p.content, p.title, p.video_url, p.created_at, p.status, ${photosOf("post", "p")}
         FROM public.posts p WHERE p.user_id = $1 ORDER BY p.created_at DESC`,
        me,
      );
      const rentals = await tx.query(
        `SELECT r.id, r.title, r.description, r.location, r.price_per_day::float AS price_per_day, r.min_days, r.created_at, r.status, ${photosOf("rental", "r")}
         FROM public.rental_listings r WHERE r.user_id = $1 ORDER BY r.created_at DESC`,
        me,
      );
      const projects = await tx.query(
        `SELECT l.id, l.title, l.description, l.location, l.budget::float AS budget, l.created_at, l.status, ${photosOf("project", "l")}
         FROM public.listings l WHERE l.user_id = $1 ORDER BY l.created_at DESC`,
        me,
      );
      return { posts: posts.rows, rentals: rentals.rows, projects: projects.rows };
    });
    return c.json(data);
  })

  // Save the text fields of one item.
  .patch("/:kind/:id", zValidator("param", target), async (c) => {
    const claims = c.get("claims")!;
    const { kind, id } = c.req.valid("param");
    const parsed = textSchemas[kind].safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? "Invalid input" });
    const n = await asUser(claims, async (_db, tx) => {
      if (kind === "post") {
        const v = parsed.data as z.infer<typeof textSchemas.post>;
        return (await tx.query("UPDATE public.posts SET title = $3, content = $4 WHERE id = $1 AND user_id = $2", [id, claims.sub, v.title.trim() || null, v.content.trim() || null])).rowCount;
      }
      if (kind === "rental") {
        const v = parsed.data as z.infer<typeof textSchemas.rental>;
        return (
          await tx.query(
            "UPDATE public.rental_listings SET title = $3, description = $4, location = $5, price_per_day = $6, min_days = $7 WHERE id = $1 AND user_id = $2",
            [id, claims.sub, v.title, v.description.trim() || null, v.location, v.price_per_day, v.min_days || 1],
          )
        ).rowCount;
      }
      const v = parsed.data as z.infer<typeof textSchemas.project>;
      const budget = v.budget.trim() ? Number(v.budget) : null;
      if (budget != null && !Number.isFinite(budget)) throw new HTTPException(400, { message: "Invalid budget" });
      return (
        await tx.query("UPDATE public.listings SET title = $3, description = $4, location = $5, budget = $6 WHERE id = $1 AND user_id = $2", [
          id,
          claims.sub,
          v.title,
          v.description.trim() || null,
          v.location.trim() || null,
          budget,
        ])
      ).rowCount;
    });
    if (!n) throw new HTTPException(404, { message: "Not found" });
    return c.json({ ok: true });
  })

  // Replace the photo set (keep = existing URLs to keep, add = newly uploaded URLs) and, for posts, the video link.
  .put(
    "/:kind/:id/media",
    zValidator("param", target),
    zValidator(
      "json",
      z.object({
        keep: z.array(z.string()).max(4),
        add: z.array(z.string().url()).max(4),
        videoUrl: z.string().url().max(2000).regex(/^https?:\/\//).nullable().optional(),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const { kind, id } = c.req.valid("param");
      const { keep, add, videoUrl } = c.req.valid("json");
      const k = KINDS[kind];
      await asUser(claims, async (_db, tx) => {
        const owned = await tx.query(`SELECT 1 FROM public.${k.table} WHERE id = $1 AND user_id = $2`, [id, claims.sub]);
        if (!owned.rowCount) throw new HTTPException(404, { message: "Not found" });
        await tx.query(`DELETE FROM public.${k.photos} WHERE ${k.fk} = $1 AND NOT (photo_url = ANY($2::text[]))`, [id, keep]);
        if (add.length) await tx.query(`INSERT INTO public.${k.photos} (${k.fk}, photo_url) SELECT $1, unnest($2::text[])`, [id, add]);
        if (kind === "post") await tx.query("UPDATE public.posts SET video_url = $3 WHERE id = $1 AND user_id = $2", [id, claims.sub, videoUrl ?? null]);
      });
      return c.json({ ok: true });
    },
  )

  .delete("/:kind/:id", zValidator("param", target), async (c) => {
    const claims = c.get("claims")!;
    const { kind, id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) => (await tx.query(`DELETE FROM public.${KINDS[kind].table} WHERE id = $1 AND user_id = $2`, [id, claims.sub])).rowCount);
    if (!n) throw new HTTPException(404, { message: "Not found" });
    return c.json({ ok: true });
  });
