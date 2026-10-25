// Rental detail page (web: routes/rentals.$rentalId.tsx). Likes live in actions.ts.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

const idParam = z.object({ id: z.string().uuid() });

export const rentalRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // New rental (web: routes/rentals.new.tsx). Starts "pending" until an admin approves it.
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(5000).nullable(),
        category: z.enum(["vehicles", "heavy", "light", "tools", "space"]),
        price_per_day: z.number().nonnegative(),
        currency: z.enum(["USD", "KHR"]),
        min_days: z.number().int().min(1).max(3650),
        availability: z.enum(["now", "from_date"]),
        available_from: z.string().date().nullable(),
        location: z.string().trim().min(1).max(200),
        photos: z.array(z.string().url()).max(4),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      const id = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO public.rental_listings (user_id, title, description, category, price_per_day, currency, min_days, availability, available_from, location, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending') RETURNING id`,
          [claims.sub, b.title, b.description, b.category, b.price_per_day, b.currency, b.min_days, b.availability, b.availability === "from_date" ? b.available_from : null, b.location],
        );
        if (b.photos.length) await tx.query("INSERT INTO public.rental_photos (listing_id, photo_url) SELECT $1, unnest($2::text[])", [rows[0].id, b.photos]);
        return rows[0].id;
      });
      return c.json({ id }, 201);
    },
  )

  // "Looking for" request (web: routes/rentals.request.new.tsx); shown once an admin approves it.
  .post(
    "/requests",
    zValidator(
      "json",
      z.object({
        title: z.string().trim().min(1).max(120),
        description: z.string().max(1000).nullable(),
        category: z.enum(["vehicles", "heavy", "light", "tools", "space"]),
        location: z.string().trim().min(1).max(120),
        budget_per_day: z.number().nonnegative().nullable(),
        currency: z.enum(["USD", "KHR"]),
        needed_from: z.string().date().nullable(),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      const id = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO public.rental_requests (user_id, title, description, category, location, budget_per_day, currency, needed_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [claims.sub, b.title, b.description, b.category, b.location, b.budget_per_day, b.currency, b.needed_from],
        );
        return rows[0].id;
      });
      return c.json({ id }, 201);
    },
  )

  .get("/:id", zValidator("param", idParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const row = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT r.id, r.user_id, r.title, r.description, r.category, r.price_per_day::float AS price_per_day, r.currency, r.min_days,
           r.availability, r.available_from::text AS available_from, r.location, r.status, r.created_at,
           COALESCE((SELECT json_agg(json_build_object('photo_url', ph.photo_url) ORDER BY ph.created_at)
                     FROM public.rental_photos ph WHERE ph.listing_id = r.id), '[]') AS rental_photos,
           CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url,
             'about_me', p.about_me, 'created_at', p.created_at) END AS profiles
         FROM public.rental_listings r LEFT JOIN public.profiles p ON p.id = r.user_id
         WHERE r.id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
    if (!row) throw new HTTPException(404, { message: "Not found" });
    return c.json(row);
  })

  // Owner's quick edit (title, description, location, price), same fields as the web dialog.
  .patch(
    "/:id",
    zValidator("param", idParam),
    zValidator(
      "json",
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(5000).nullable(),
        location: z.string().trim().min(1).max(200),
        price_per_day: z.number().nonnegative(),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const b = c.req.valid("json");
      const n = await asUser(claims, async (_db, tx) =>
        (
          await tx.query("UPDATE public.rental_listings SET title = $2, description = $3, location = $4, price_per_day = $5 WHERE id = $1", [
            id,
            b.title,
            b.description?.trim() || null,
            b.location,
            b.price_per_day,
          ])
        ).rowCount,
      );
      if (!n) throw new HTTPException(404, { message: "Not found" });
      return c.json({ ok: true });
    },
  )

  .delete("/:id", zValidator("param", idParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) => (await tx.query("DELETE FROM public.rental_listings WHERE id = $1", [id])).rowCount);
    if (!n) throw new HTTPException(404, { message: "delete_failed" });
    return c.json({ ok: true });
  });
