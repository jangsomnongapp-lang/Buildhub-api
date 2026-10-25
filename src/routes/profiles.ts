// Profile pages (web: routes/profile.tsx, routes/users.$userId.tsx, lib/help-request.functions.ts).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type pg from "pg";
import { asUser, pool } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";
import { toFileUrl } from "../media/inline";
import { publicBase } from "./uploads";

const PROFILE_COLUMNS =
  "id, full_name, avatar_url, about_me, is_provider, is_coordinator, is_organization, is_client, member_number, is_verified, is_recruiter, is_featured, is_specialist";

// Store owners always see their shop page instead of a profile (both pages redirect on the web).
async function storeIdOf(tx: pg.PoolClient, userId: string) {
  const { rows } = await tx.query<{ id: string }>("SELECT id FROM public.supplier_stores WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [userId]);
  return rows[0]?.id ?? null;
}

// Header data shared by both pages: profile, today's availability and up to all categories.
async function profileHeader(tx: pg.PoolClient, userId: string) {
  const { rows } = await tx.query(
    `SELECT ${PROFILE_COLUMNS.split(", ").map((c) => (c === "member_number" ? "p.member_number::int AS member_number" : `p.${c}`)).join(", ")},
       public.get_today_availability(p.id) AS availability,
       COALESCE((SELECT json_agg(json_build_object('name_en', c.name_en, 'name_km', c.name_km))
                 FROM public.user_categories uc JOIN public.categories c ON c.id = uc.category_id
                 WHERE uc.user_id = p.id), '[]') AS categories,
       COALESCE((SELECT json_agg(json_build_object('id', ph.id, 'photo_url', ph.photo_url) ORDER BY ph.created_at DESC)
                 FROM public.portfolio_photos ph WHERE ph.user_id = p.id), '[]') AS portfolio
     FROM public.profiles p WHERE p.id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export const profileRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Everything /profile shows for the signed-in user.
  .get("/me", async (c) => {
    const claims = c.get("claims")!;
    const me = claims.sub;
    const data = await asUser(claims, async (_db, tx) => {
      const storeId = await storeIdOf(tx, me);
      if (storeId) return { storeId };
      const profile = await profileHeader(tx, me);
      const listings = await tx.query("SELECT id, title, status FROM public.listings WHERE user_id = $1 ORDER BY created_at DESC", [me]);
      const apps = await tx.query<{ status: string; listing: { id: string; title: string; status: string } | null }>(
        `SELECT a.status, CASE WHEN l.id IS NULL THEN NULL ELSE json_build_object('id', l.id, 'title', l.title, 'status', l.status) END AS listing
         FROM public.applications a LEFT JOIN public.listings l ON l.id = a.listing_id
         WHERE a.applicant_id = $1`,
        [me],
      );
      const rentals = await tx.query(
        `SELECT id, title, status, price_per_day::float AS price_per_day, currency, category, availability, available_from::text AS available_from
         FROM public.rental_listings WHERE user_id = $1 ORDER BY created_at DESC`,
        [me],
      );
      const projects = await tx.query(
        `SELECT pr.id, pr.status, pr.completion_requested_by,
           CASE WHEN pr.owner_id = $1 THEN 'owner' ELSE 'worker' END AS role,
           CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id', o.id, 'full_name', o.full_name, 'avatar_url', o.avatar_url) END AS other,
           EXISTS (SELECT 1 FROM public.project_ratings r WHERE r.project_id = pr.id AND r.rater_id = $1) AS rated
         FROM public.projects pr
         LEFT JOIN public.profiles o ON o.id = CASE WHEN pr.owner_id = $1 THEN pr.worker_id ELSE pr.owner_id END
         WHERE pr.owner_id = $1 OR pr.worker_id = $1
         ORDER BY pr.created_at DESC`,
        [me],
      );
      const tickets = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM public.lottery_tickets WHERE user_id = $1 AND status = 'active'", [me]);
      return {
        storeId: null,
        profile,
        listings: listings.rows,
        appliedCount: apps.rows.length,
        doingListings: apps.rows.filter((a) => a.status === "accepted" && a.listing && a.listing.status !== "closed").map((a) => a.listing),
        rentals: rentals.rows,
        projects: projects.rows,
        activeTicketCount: tickets.rows[0].n,
      };
    });
    return c.json(data);
  })

  // Profile photo. /profile sends it inline as a JPEG data: URL (≤ 400 KB, as on the web); it is saved
  // as a file and only the link is stored. /profile/edit uploads it first and sends the URL.
  .patch(
    "/me/avatar",
    zValidator(
      "json",
      z.object({ avatarUrl: z.union([z.string().regex(/^data:image\/(jpeg|png|webp);base64,/).max(560_000), z.string().url().max(2000)]) }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const avatarUrl = await toFileUrl(c.req.valid("json").avatarUrl, publicBase(c.req.url));
      await asUser(claims, (_db, tx) => tx.query("UPDATE public.profiles SET avatar_url = $2 WHERE id = $1", [claims.sub, avatarUrl]));
      return c.json({ ok: true });
    },
  )

  // /profile/edit form data. Phone comes from get_user_phone (profiles.phone isn't readable).
  .get("/me/edit", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT p.full_name, p.avatar_url, p.about_me, p.is_provider, p.is_coordinator, p.is_organization, p.is_client,
           public.get_user_phone(p.id) AS phone,
           COALESCE((SELECT json_agg(uc.category_id) FROM public.user_categories uc WHERE uc.user_id = p.id), '[]') AS category_ids,
           COALESCE((SELECT json_agg(json_build_object('id', ph.id, 'photo_url', ph.photo_url) ORDER BY ph.created_at DESC)
                     FROM public.portfolio_photos ph WHERE ph.user_id = p.id), '[]') AS portfolio
         FROM public.profiles p WHERE p.id = $1`,
        [claims.sub],
      );
      return rows[0] ?? null;
    });
    if (!data) throw new HTTPException(404, { message: "Not found" });
    return c.json(data);
  })

  // Save /profile/edit: same three writes as the web (profile row, role flags RPC, replace categories).
  .patch(
    "/me",
    zValidator(
      "json",
      z.object({
        fullName: z.string().max(200),
        phone: z.string().max(30),
        aboutMe: z.string().max(5000),
        roles: z.object({ is_provider: z.boolean(), is_coordinator: z.boolean(), is_organization: z.boolean(), is_client: z.boolean() }),
        categoryIds: z.array(z.string().uuid()).max(100),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      const digits = b.phone.replace(/\D/g, "");
      await asUser(claims, async (_db, tx) => {
        await tx.query("UPDATE public.profiles SET full_name = $2, phone = $3, about_me = $4 WHERE id = $1", [
          claims.sub,
          b.fullName.trim() || null,
          b.phone ? `+855${digits}` : null,
          b.aboutMe.trim() || null,
        ]);
        await tx.query("SELECT public.update_my_role_flags($1, $2, $3, $4)", [b.roles.is_provider, b.roles.is_coordinator, b.roles.is_organization, b.roles.is_client]);
        await tx.query("DELETE FROM public.user_categories WHERE user_id = $1", [claims.sub]);
        if (b.categoryIds.length)
          await tx.query("INSERT INTO public.user_categories (user_id, category_id) SELECT $1, unnest($2::uuid[])", [claims.sub, b.categoryIds]);
      });
      return c.json({ ok: true });
    },
  )

  // /profile/portfolio: my photos and my jobs with their applicant counts.
  .get("/me/portfolio", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const photos = await tx.query("SELECT id, photo_url FROM public.portfolio_photos WHERE user_id = $1 ORDER BY created_at DESC", [claims.sub]);
      const listings = await tx.query(
        `SELECT l.id, l.title, l.status, (SELECT count(*)::int FROM public.applications a WHERE a.listing_id = l.id) AS applicant_count
         FROM public.listings l WHERE l.user_id = $1 ORDER BY l.created_at DESC`,
        [claims.sub],
      );
      return { photos: photos.rows, listings: listings.rows };
    });
    return c.json(data);
  })

  .delete("/me/portfolio/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) => (await tx.query("DELETE FROM public.portfolio_photos WHERE id = $1", [id])).rowCount);
    if (!n) throw new HTTPException(404, { message: "Not found" });
    return c.json({ ok: true });
  })

  // Add portfolio photos (already uploaded through /uploads/portfolio).
  .post("/me/portfolio", zValidator("json", z.object({ urls: z.array(z.string().url()).min(1).max(20) })), async (c) => {
    const claims = c.get("claims")!;
    const { urls } = c.req.valid("json");
    const rows = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        "INSERT INTO public.portfolio_photos (user_id, photo_url) SELECT $1, unnest($2::text[]) RETURNING id, photo_url",
        [claims.sub, urls],
      );
      return rows;
    });
    return c.json(rows, 201);
  })

  // Port of requestFreeHelp: notify every admin, plus a receipt in the requester's own alerts.
  .post("/me/help-request", async (c) => {
    const claims = c.get("claims")!;
    const me = claims.sub;
    const { listing, profile } = await asUser(claims, async (_db, tx) => {
      const l = await tx.query<{ id: string }>("SELECT id FROM public.listings WHERE user_id = $1 AND status = 'active' LIMIT 1", [me]);
      const p = await tx.query<{ full_name: string | null; is_client: boolean }>("SELECT full_name, is_client FROM public.profiles WHERE id = $1", [me]);
      return { listing: l.rows[0], profile: p.rows[0] };
    });
    if (!listing) throw new HTTPException(400, { message: "You must have at least 1 active project to request help." });
    const name = profile?.full_name ?? "Someone";
    const title = `Free help request from ${name}`;
    const body = profile?.is_client
      ? `${name} is requesting free technical advice for their construction project.`
      : `${name} is requesting free advice on how to execute their work.`;
    // Server-side system action (the web used the service-role client): users can't see who is admin
    // or write other users' notifications, so this runs on the privileged pool.
    await pool.query(
      `INSERT INTO public.notifications (user_id, kind, title, body, related_user_id, related_listing_id)
       SELECT id, 'help_request', $2, $3, $1, $4 FROM public.profiles WHERE is_admin = true`,
      [me, title, body, listing.id],
    );
    await pool.query(
      `INSERT INTO public.notifications (user_id, kind, title, body, related_listing_id)
       VALUES ($1, 'help_request_sent', 'Your free help request was sent', 'An admin will contact you shortly.', $2)`,
      [me, listing.id],
    );
    return c.json({ ok: true });
  })

  // Just the name and avatar (e.g. the worker card on /projects/new/:workerId).
  .get("/:id/card", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const row = await asUser(claims, async (_db, tx) => (await tx.query("SELECT id, full_name, avatar_url FROM public.profiles WHERE id = $1", [id])).rows[0]);
    if (!row) throw new HTTPException(404, { message: "Not found" });
    return c.json(row);
  })

  // Someone else's profile (/users/:id).
  .get("/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const data = await asUser(claims, async (_db, tx) => {
      const storeId = await storeIdOf(tx, id);
      if (storeId) return { storeId };
      const profile = await profileHeader(tx, id);
      if (!profile) return null;
      const listings = await tx.query<{ id: string; title: string; location: string | null; status: string }>(
        "SELECT id, title, location, status FROM public.listings WHERE user_id = $1 ORDER BY created_at DESC",
        [id],
      );
      const applied = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM public.applications WHERE applicant_id = $1", [id]);
      const posts = await tx.query(
        `SELECT p.id, p.title, p.content, p.created_at, p.post_type,
           (SELECT ph.photo_url FROM public.post_photos ph WHERE ph.post_id = p.id ORDER BY ph.created_at LIMIT 1) AS photo
         FROM public.posts p WHERE p.user_id = $1 AND p.status = 'approved'
         ORDER BY p.created_at DESC LIMIT 20`,
        [id],
      );
      const reviews = await tx.query(
        `SELECT r.id, r.stars, r.comment, r.created_at,
           CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url) END AS rater
         FROM public.get_user_reviews($1) r LEFT JOIN public.profiles p ON p.id = r.rater_id`,
        [id],
      );
      const mine = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM public.listings WHERE user_id = $1", [claims.sub]);
      return {
        storeId: null,
        profile,
        postedCount: listings.rows.length,
        activeProjects: listings.rows.filter((l) => l.status === "active"),
        appliedCount: applied.rows[0].n,
        posts: posts.rows,
        reviews: reviews.rows,
        myPostedCount: mine.rows[0].n,
      };
    });
    if (!data) throw new HTTPException(404, { message: "Not found" });
    return c.json(data);
  });
