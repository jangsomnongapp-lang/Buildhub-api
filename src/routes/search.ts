// Global search (web: routes/search.tsx): people, approved suppliers, approved listings, approved posts and
// published blog posts that contain the term, 20 of each. Also logs the term to `catalog_search_events`,
// as the web did on every submit (the catalogue panel's "most searched" uses it).
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

/** Escape LIKE wildcards so the search matches them literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export const searchRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  .post("/", zValidator("json", z.object({ q: z.string().trim().min(1).max(200) })), async (c) => {
    const claims = c.get("claims")!;
    const { q } = c.req.valid("json");
    const needle = `%${likeEscape(q)}%`;
    const data = await asUser(claims, async (_db, tx) => {
      const people = await tx.query(
        "SELECT id, full_name, avatar_url, about_me FROM public.profiles WHERE full_name ILIKE $1 OR about_me ILIKE $1 LIMIT 20",
        [needle],
      );
      const suppliers = await tx.query(
        `SELECT id, name, description, logo_url, location FROM public.supplier_stores
         WHERE status = 'approved' AND (name ILIKE $1 OR description ILIKE $1 OR location ILIKE $1) LIMIT 20`,
        [needle],
      );
      const listings = await tx.query(
        `SELECT id, title, description, location, budget::float AS budget, currency FROM public.listings
         WHERE status = 'approved' AND (title ILIKE $1 OR description ILIKE $1 OR location ILIKE $1) LIMIT 20`,
        [needle],
      );
      const posts = await tx.query(
        `SELECT p.id, p.content, p.user_id, p.created_at,
           CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('id', a.id, 'full_name', a.full_name, 'avatar_url', a.avatar_url) END AS author
         FROM public.posts p LEFT JOIN public.profiles a ON a.id = p.user_id
         WHERE p.status = 'approved' AND p.content ILIKE $1 ORDER BY p.created_at DESC LIMIT 20`,
        [needle],
      );
      const blog = await tx.query(
        `SELECT id, slug, title, excerpt, cover_image_url, published_at FROM public.blog_posts
         WHERE status = 'published' AND (title ILIKE $1 OR excerpt ILIKE $1 OR content ILIKE $1)
         ORDER BY published_at DESC NULLS LAST LIMIT 20`,
        [needle],
      );
      return { people: people.rows, suppliers: suppliers.rows, listings: listings.rows, posts: posts.rows, blog: blog.rows };
    });
    // Fire-and-forget on the web: a failed log never blocks the results.
    await asUser(claims, (_db, tx) => tx.query("INSERT INTO public.catalog_search_events (term) VALUES ($1)", [q.slice(0, 120)])).catch(() => undefined);
    return c.json(data);
  });
