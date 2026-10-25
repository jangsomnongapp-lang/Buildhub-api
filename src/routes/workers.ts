// Find worker (web: routes/find-worker.tsx): workers, team leaders and companies, newest first.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

const PAGE_SIZE = 40;

/** Escape LIKE wildcards so the search matches them literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export const workerRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // One page of 40, optionally limited to one category and a name/about search. Each row carries
  // today's availability and its categories (the web fetched both in follow-up queries).
  .get(
    "/",
    zValidator(
      "query",
      z.object({
        page: z.coerce.number().int().min(0).default(0),
        q: z.string().max(100).optional(),
        category: z.string().uuid().optional(),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const { page, q, category } = c.req.valid("query");
      const needle = q?.trim() ? `%${likeEscape(q.trim())}%` : null;
      const rows = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query(
          `WITH page AS (
             SELECT p.id, p.full_name, p.avatar_url, p.about_me, p.is_provider, p.is_coordinator, p.is_organization, p.created_at
             FROM public.profiles p
             WHERE (p.is_provider OR p.is_coordinator OR p.is_organization)
               AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM public.user_categories uc WHERE uc.user_id = p.id AND uc.category_id = $1))
               AND ($2::text IS NULL OR p.full_name ILIKE $2 OR p.about_me ILIKE $2)
             ORDER BY p.created_at DESC
             LIMIT $3 OFFSET $4
           )
           SELECT page.id, page.full_name, page.avatar_url, page.about_me, page.is_provider, page.is_coordinator, page.is_organization,
             a.status AS availability,
             COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name_en', c.name_en, 'name_km', c.name_km))
                       FROM public.user_categories uc JOIN public.categories c ON c.id = uc.category_id
                       WHERE uc.user_id = page.id), '[]') AS categories
           FROM page
           LEFT JOIN public.get_today_availability_bulk((SELECT array_agg(id) FROM page)) a ON a.user_id = page.id
           ORDER BY page.created_at DESC`,
          [category ?? null, needle, PAGE_SIZE, page * PAGE_SIZE],
        );
        return rows;
      });
      return c.json({ workers: rows, hasMore: rows.length === PAGE_SIZE });
    },
  );
