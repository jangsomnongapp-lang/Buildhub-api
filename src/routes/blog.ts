// Public blog (web: routes/blog.index.tsx, blog.$slug.tsx and lib/blog.functions.ts). No login needed;
// RLS only shows published posts.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, type AuthEnv } from "../auth/middleware";

const CATEGORY = `(SELECT json_build_object('slug', c.slug, 'name_en', c.name_en, 'name_km', c.name_km)
  FROM public.blog_categories c WHERE c.id = p.category_id) AS blog_categories`;

export const blogRoutes = new Hono<AuthEnv>()
  .use(optionalAuth)

  // Categories + every published post, newest first. The page filters by category and search itself.
  .get("/", async (c) =>
    c.json(
      await asUser(c.get("claims"), async (_db, tx) => {
        const [categories, posts] = await Promise.all([
          tx.query("SELECT id, slug, name_en, name_km FROM public.blog_categories ORDER BY sort_order"),
          tx.query(
            `SELECT p.id, p.slug, p.title, p.excerpt, p.cover_image_url, p.published_at, p.author_name, ${CATEGORY}
             FROM public.blog_posts p WHERE p.status = 'published' ORDER BY p.published_at DESC NULLS LAST`,
          ),
        ]);
        return { categories: categories.rows, posts: posts.rows };
      }),
    ),
  )

  .get("/:slug", zValidator("param", z.object({ slug: z.string().min(1).max(300) })), async (c) => {
    const { slug } = c.req.valid("param");
    const post = await asUser(c.get("claims"), async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT p.id, p.slug, p.title, p.excerpt, p.content, p.cover_image_url, p.published_at, p.author_name,
           p.meta_title, p.meta_description, ${CATEGORY}
         FROM public.blog_posts p WHERE p.slug = $1 AND p.status = 'published' LIMIT 1`,
        [slug],
      );
      return rows[0] ?? null;
    });
    return c.json({ post });
  });
