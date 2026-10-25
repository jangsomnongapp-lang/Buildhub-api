// Jobs / project listings (web: listings.index.tsx, listings.new.tsx).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

const idParam = z.object({ id: z.string().uuid() });

export const listingRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // "Find work": the 20 newest active listings from the last 60 days, plus the ones I applied to.
  .get("/", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const listings = await tx.query(
        `SELECT l.id, l.user_id, l.title, l.description, l.budget::float8 AS budget, COALESCE(l.currency, 'USD') AS currency,
           l.location, l.created_at,
           json_build_object('full_name', pr.full_name, 'avatar_url', pr.avatar_url) AS profiles,
           COALESCE((SELECT json_agg(json_build_object('categories', json_build_object('id', cat.id, 'name_en', cat.name_en, 'name_km', cat.name_km)))
                     FROM public.listing_categories lc JOIN public.categories cat ON cat.id = lc.category_id
                     WHERE lc.listing_id = l.id), '[]'::json) AS listing_categories
         FROM public.listings l LEFT JOIN public.profiles pr ON pr.id = l.user_id
         WHERE l.status = 'active' AND l.created_at >= now() - interval '60 days'
         ORDER BY l.created_at DESC LIMIT 20`,
      );
      const applied = await tx.query<{ listing_id: string }>("SELECT listing_id FROM public.applications WHERE applicant_id = $1", [claims.sub]);
      return { listings: listings.rows, appliedIds: applied.rows.map((r) => r.listing_id) };
    });
    return c.json(data);
  })

  // Post a job. It starts as "pending" until an admin approves it (same as the web).
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(5000).optional(),
        location: z.string().trim().max(100).optional(),
        budget: z.number().nonnegative().nullable().optional(),
        currency: z.enum(["USD", "KHR"]).default("USD"),
        categoryIds: z.array(z.string().uuid()).min(1),
        photos: z.array(z.string().url()).max(12).default([]),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      const id = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO public.listings (user_id, title, description, location, budget, currency, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
          [claims.sub, b.title, b.description || null, b.location || null, b.budget ?? null, b.currency],
        );
        const listingId = rows[0].id;
        for (const categoryId of b.categoryIds) {
          await tx.query("INSERT INTO public.listing_categories (listing_id, category_id) VALUES ($1, $2)", [listingId, categoryId]);
        }
        for (const url of b.photos) {
          await tx.query("INSERT INTO public.listing_photos (listing_id, photo_url) VALUES ($1, $2)", [listingId, url]);
        }
        return listingId;
      });
      return c.json({ id }, 201);
    },
  )

  // Close / reopen (web: profile.portfolio.tsx). The guard_listing_fields trigger only lets owners move a job
  // to finished/closed, so a reopen is silently kept closed; we return the status that was actually stored.
  .patch("/:id/status", zValidator("param", idParam), zValidator("json", z.object({ status: z.enum(["active", "closed"]) })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const row = await asUser(claims, async (_db, tx) =>
      (await tx.query<{ status: string }>("UPDATE public.listings SET status = $2 WHERE id = $1 RETURNING status", [id, status])).rows[0],
    );
    if (!row) throw new HTTPException(404, { message: "Not found" });
    return c.json({ status: row.status });
  })

  .patch(
    "/:id",
    zValidator("param", idParam),
    zValidator(
      "json",
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(5000).nullable(),
        location: z.string().trim().max(100).nullable(),
        budget: z.number().nonnegative().nullable(),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const b = c.req.valid("json");
      const n = await asUser(claims, async (_db, tx) =>
        (
          await tx.query("UPDATE public.listings SET title = $2, description = $3, location = $4, budget = $5 WHERE id = $1", [
            id,
            b.title,
            b.description || null,
            b.location || null,
            b.budget,
          ])
        ).rowCount,
      );
      if (!n) throw new HTTPException(403, { message: "forbidden" });
      return c.json({ ok: true });
    },
  )

  .delete("/:id", zValidator("param", idParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) => (await tx.query("DELETE FROM public.listings WHERE id = $1", [id])).rowCount);
    if (!n) throw new HTTPException(403, { message: "forbidden" });
    return c.json({ ok: true });
  })

  // Detail page: listing, how many jobs the client posted, whether I applied, and (owner only) the applicants.
  .get("/:id", zValidator("param", idParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const data = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT l.id, l.user_id, l.title, l.description, l.budget::float8 AS budget, COALESCE(l.currency, 'USD') AS currency,
           l.location, l.status, l.created_at,
           json_build_object('full_name', pr.full_name, 'avatar_url', pr.avatar_url) AS profiles,
           COALESCE((SELECT json_agg(json_build_object('categories', json_build_object('name_en', cat.name_en, 'name_km', cat.name_km)))
                     FROM public.listing_categories lc JOIN public.categories cat ON cat.id = lc.category_id
                     WHERE lc.listing_id = l.id), '[]'::json) AS listing_categories,
           COALESCE((SELECT json_agg(json_build_object('photo_url', ph.photo_url) ORDER BY ph.created_at)
                     FROM public.listing_photos ph WHERE ph.listing_id = l.id), '[]'::json) AS listing_photos
         FROM public.listings l LEFT JOIN public.profiles pr ON pr.id = l.user_id
         WHERE l.id = $1`,
        [id],
      );
      const listing = rows[0];
      if (!listing) return null;
      const [posted, applied, applicants] = await Promise.all([
        tx.query<{ n: number }>("SELECT count(*)::int AS n FROM public.listings WHERE user_id = $1", [listing.user_id]),
        tx.query("SELECT 1 FROM public.applications WHERE listing_id = $1 AND applicant_id = $2", [id, claims.sub]),
        // RLS only returns applications to their owner or the listing owner; applicants are shown to the owner.
        listing.user_id === claims.sub
          ? tx.query(
              `SELECT a.id, a.applicant_id, a.created_at, a.status,
                 json_build_object('full_name', pr.full_name, 'avatar_url', pr.avatar_url) AS profiles
               FROM public.applications a LEFT JOIN public.profiles pr ON pr.id = a.applicant_id
               WHERE a.listing_id = $1 ORDER BY a.created_at DESC`,
              [id],
            )
          : Promise.resolve({ rows: [] }),
      ]);
      return { listing, postedCount: posted.rows[0].n, applied: !!applied.rowCount, applicants: applicants.rows };
    });
    if (!data) throw new HTTPException(404, { message: "not_found" });
    return c.json(data);
  })

  // Owner marks the job finished. If a worker was accepted, a completed project is created
  // so both sides can rate each other (ratings live on projects), as on the web.
  .post("/:id/finish", zValidator("param", idParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const result = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query<{ status: string; budget: number | null }>(
        "UPDATE public.listings SET status = 'finished' WHERE id = $1 AND user_id = $2 RETURNING status, budget::float8 AS budget",
        [id, claims.sub],
      );
      if (!rows[0] || rows[0].status !== "finished") return null;
      const accepted = await tx.query<{ applicant_id: string; full_name: string | null }>(
        `SELECT a.applicant_id, pr.full_name FROM public.applications a LEFT JOIN public.profiles pr ON pr.id = a.applicant_id
         WHERE a.listing_id = $1 AND a.status = 'accepted' AND a.applicant_id <> $2 LIMIT 1`,
        [id, claims.sub],
      );
      if (!accepted.rows[0]) return { project: null };
      const proj = await tx.query<{ id: string }>(
        `INSERT INTO public.projects (owner_id, worker_id, status, agreed_price, setup_completed)
         VALUES ($1, $2, 'completed', $3, true) RETURNING id`,
        [claims.sub, accepted.rows[0].applicant_id, rows[0].budget],
      );
      return { project: { id: proj.rows[0].id, name: accepted.rows[0].full_name ?? "—" } };
    });
    if (!result) throw new HTTPException(403, { message: "forbidden" });
    return c.json(result);
  })

  .post(
    "/:id/applications/:appId/accept",
    zValidator("param", z.object({ id: z.string().uuid(), appId: z.string().uuid() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id, appId } = c.req.valid("param");
      const n = await asUser(claims, async (_db, tx) =>
        (await tx.query("UPDATE public.applications SET status = 'accepted' WHERE id = $1 AND listing_id = $2", [appId, id])).rowCount,
      );
      if (!n) throw new HTTPException(403, { message: "forbidden" });
      return c.json({ ok: true });
    },
  )

  .post("/:id/apply", zValidator("param", idParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    await asUser(claims, (_db, tx) => tx.query("INSERT INTO public.applications (listing_id, applicant_id) VALUES ($1, $2)", [id, claims.sub]));
    return c.json({ ok: true }, 201);
  });

// Reference data shared by many screens.
export const referenceRoutes = new Hono<AuthEnv>().get("/categories", async (c) => {
  const rows = await asUser(null, async (_db, tx) => {
    const { rows } = await tx.query(
      "SELECT id, code, name_en, name_km, group_en, group_km FROM public.categories WHERE is_active ORDER BY sort_order",
    );
    return rows;
  });
  return c.json(rows);
});
