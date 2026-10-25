// Home feed. Same data the web's home.tsx loaded straight from Supabase, one request per page.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type pg from "pg";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

const PAGE_SIZE = 20;
const REACTIONS = ["like", "love", "haha", "wow", "sad"] as const;
type Reaction = (typeof REACTIONS)[number];

interface LikeInfo {
  count: number;
  mine: boolean;
  reaction: Reaction | null;
  top: Reaction[];
}

// Columns of profiles that authenticated users may read (phone/is_admin are hidden by grants).
const POST_SELECT = `
  SELECT p.id, p.user_id, p.content, p.video_url, p.created_at,
    json_build_object('full_name', pr.full_name, 'avatar_url', pr.avatar_url, 'is_verified', pr.is_verified,
      'is_recruiter', pr.is_recruiter, 'is_featured', pr.is_featured, 'is_supplier', pr.is_supplier) AS profiles,
    COALESCE((SELECT json_agg(json_build_object('photo_url', ph.photo_url) ORDER BY ph.created_at, ph.id)
              FROM public.post_photos ph WHERE ph.post_id = p.id), '[]'::json) AS post_photos
  FROM public.posts p LEFT JOIN public.profiles pr ON pr.id = p.user_id`;

/** Likes per post: total, the caller's reaction and the 3 most-used reactions. */
async function postLikes(tx: pg.PoolClient, ids: string[], uid: string) {
  const out: Record<string, LikeInfo> = {};
  for (const id of ids) out[id] = { count: 0, mine: false, reaction: null, top: [] };
  if (!ids.length) return out;
  const { rows } = await tx.query<{ post_id: string; reaction: Reaction; n: number; mine: boolean }>(
    `SELECT post_id, COALESCE(reaction, 'like') AS reaction, count(*)::int AS n, bool_or(user_id = $2) AS mine
     FROM public.post_likes WHERE post_id = ANY($1) GROUP BY 1, 2`,
    [ids, uid],
  );
  const counts: Record<string, [Reaction, number][]> = {};
  for (const r of rows) {
    const e = out[r.post_id];
    e.count += r.n;
    if (r.mine) {
      e.mine = true;
      e.reaction = r.reaction;
    }
    (counts[r.post_id] ??= []).push([r.reaction, r.n]);
  }
  for (const id of ids) out[id].top = (counts[id] ?? []).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r);
  return out;
}

async function countBy(tx: pg.PoolClient, table: string, column: string, ids: string[]) {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = 0;
  if (!ids.length) return out;
  const { rows } = await tx.query<{ id: string; n: number }>(
    `SELECT ${column} AS id, count(*)::int AS n FROM public.${table} WHERE ${column} = ANY($1) GROUP BY 1`,
    [ids],
  );
  for (const r of rows) out[r.id] = r.n;
  return out;
}

async function suppliersByUser(tx: pg.PoolClient, userIds: string[]) {
  const out: Record<string, { id: string; name: string; logo_url: string | null; category_en: string | null; category_km: string | null; photos: string[] }> = {};
  if (!userIds.length) return out;
  const { rows } = await tx.query(
    `SELECT s.id, s.user_id, s.name, s.logo_url,
       (SELECT c.name_en FROM public.supplier_store_categories sc JOIN public.supplier_categories c ON c.id = sc.category_id
        WHERE sc.store_id = s.id ORDER BY sc.created_at LIMIT 1) AS category_en,
       (SELECT c.name_km FROM public.supplier_store_categories sc JOIN public.supplier_categories c ON c.id = sc.category_id
        WHERE sc.store_id = s.id ORDER BY sc.created_at LIMIT 1) AS category_km,
       COALESCE((SELECT json_agg(ph.photo_url ORDER BY ph.sort_order NULLS FIRST, ph.created_at)
                 FROM public.supplier_store_photos ph WHERE ph.store_id = s.id), '[]'::json) AS photos
     FROM public.supplier_stores s WHERE s.user_id = ANY($1) ORDER BY s.created_at`,
    [userIds],
  );
  // A user with several stores: the newest wins (later rows overwrite).
  for (const s of rows) out[s.user_id] = { id: s.id, name: s.name, logo_url: s.logo_url, category_en: s.category_en, category_km: s.category_km, photos: s.photos };
  return out;
}

export const feedRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  .get("/home", zValidator("query", z.object({ page: z.coerce.number().int().min(0).default(0) })), async (c) => {
    const claims = c.get("claims")!;
    const offset = c.req.valid("query").page * PAGE_SIZE;
    const page = await asUser(claims, async (_db, tx) => {
      const [posts, rentals] = await Promise.all([
        tx.query(`${POST_SELECT} WHERE p.status = 'approved' ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`, [PAGE_SIZE, offset]),
        tx.query(
          `SELECT r.id, r.user_id, r.title, r.description, r.category, r.price_per_day::float8 AS price_per_day, r.currency,
             r.location, r.availability, r.available_from, r.created_at,
             json_build_object('full_name', pr.full_name, 'avatar_url', pr.avatar_url) AS profiles,
             COALESCE((SELECT json_agg(json_build_object('photo_url', ph.photo_url) ORDER BY ph.created_at, ph.id)
                       FROM public.rental_photos ph WHERE ph.listing_id = r.id), '[]'::json) AS rental_photos
           FROM public.rental_listings r LEFT JOIN public.profiles pr ON pr.id = r.user_id
           WHERE r.status = 'approved' ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`,
          [PAGE_SIZE, offset],
        ),
      ]);
      const postIds = posts.rows.map((p) => p.id);
      const rentalIds = rentals.rows.map((r) => r.id);
      const [likes, commentCounts, rentalLikeRows, rentalCommentCounts, supplierByUser] = await Promise.all([
        postLikes(tx, postIds, claims.sub),
        countBy(tx, "post_comments", "post_id", postIds),
        rentalIds.length
          ? tx.query<{ rental_id: string; n: number; mine: boolean }>(
              `SELECT rental_id, count(*)::int AS n, bool_or(user_id = $2) AS mine FROM public.rental_likes WHERE rental_id = ANY($1) GROUP BY 1`,
              [rentalIds, claims.sub],
            )
          : Promise.resolve({ rows: [] as { rental_id: string; n: number; mine: boolean }[] }),
        countBy(tx, "rental_comments", "rental_id", rentalIds),
        suppliersByUser(tx, [...new Set(posts.rows.map((p) => p.user_id as string))]),
      ]);
      const rentalLikes: Record<string, { count: number; mine: boolean }> = {};
      for (const id of rentalIds) rentalLikes[id] = { count: 0, mine: false };
      for (const r of rentalLikeRows.rows) rentalLikes[r.rental_id] = { count: r.n, mine: r.mine };
      return {
        posts: posts.rows,
        rentals: rentals.rows,
        likes,
        commentCounts,
        rentalLikes,
        rentalCommentCounts,
        supplierByUser,
        hasMore: posts.rows.length === PAGE_SIZE || rentals.rows.length === PAGE_SIZE,
      };
    });
    return c.json(page);
  })

  // One post with its counts (opened from a shared link: /home?post=<id>).
  .get("/posts/:id", async (c) => {
    const claims = c.get("claims")!;
    const id = c.req.param("id");
    const data = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(`${POST_SELECT} WHERE p.id = $1`, [id]);
      if (!rows[0]) return null;
      const [likes, commentCounts, supplierByUser] = await Promise.all([
        postLikes(tx, [id], claims.sub),
        countBy(tx, "post_comments", "post_id", [id]),
        suppliersByUser(tx, [rows[0].user_id]),
      ]);
      return { post: rows[0], like: likes[id], commentCount: commentCounts[id], supplier: supplierByUser[rows[0].user_id] ?? null };
    });
    if (!data) return c.json({ error: "not_found" }, 404);
    return c.json(data);
  })

  // Newest approved story per user, from the 50 most recent stories.
  .get("/stories", async (c) => {
    const claims = c.get("claims")!;
    const rows = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `WITH recent AS (
           SELECT s.id, s.user_id, s.media_url, s.created_at FROM public.stories s
           WHERE s.status = 'approved' AND s.expires_at > now()
           ORDER BY s.created_at DESC LIMIT 50
         ), firsts AS (
           SELECT DISTINCT ON (user_id) * FROM recent ORDER BY user_id, created_at DESC
         )
         SELECT f.id, f.user_id, pr.full_name, pr.avatar_url, f.media_url AS cover
         FROM firsts f LEFT JOIN public.profiles pr ON pr.id = f.user_id
         ORDER BY f.created_at DESC`,
      );
      return rows;
    });
    return c.json(rows);
  })

  .get("/followed-store-owners", async (c) => {
    const claims = c.get("claims")!;
    const ids = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query<{ owner_id: string }>("SELECT owner_id FROM public.followed_store_owner_ids()");
      return rows.map((r) => r.owner_id);
    });
    return c.json(ids);
  });
