// Market + Suppliers list pages (web: routes/suppliers.index.tsx, used by /suppliers and /market).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

type Cat = { id: string; code: string; name_en: string; name_km: string };
type Store = { id: string; user_id: string; name: string; description: string | null; location: string | null; logo_url: string | null; created_at: string };

export const marketRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Shops mode: supplier products (posts) + catalog items + approved stores, same limits as the web (60 each).
  .get("/shops", zValidator("query", z.object({ q: z.string().max(120).optional() })), async (c) => {
    const claims = c.get("claims")!;
    const term = c.req.valid("query").q?.trim();
    const data = await asUser(claims, async (_db, tx) => {
      const needle = term ? `%${likeEscape(term)}%` : null;
      const posts = await tx.query<{
        id: string;
        user_id: string;
        title: string | null;
        content: string | null;
        price: number | null;
        discount_price: number | null;
        currency: string | null;
        post_type: string | null;
        category: string | null;
        created_at: string;
        photo_url: string | null;
      }>(
        `SELECT p.id, p.user_id, p.title, p.content, p.price::float AS price, p.discount_price::float AS discount_price, p.currency,
           p.post_type, p.category, p.created_at,
           (SELECT ph.photo_url FROM public.post_photos ph WHERE ph.post_id = p.id ORDER BY ph.created_at LIMIT 1) AS photo_url
         FROM public.posts p
         WHERE p.status = 'approved' AND p.post_type IN ('novedad', 'stock', 'oferta', 'liquidacion')
           AND ($1::text IS NULL OR p.title ILIKE $1 OR p.content ILIKE $1)
         ORDER BY p.created_at DESC LIMIT 60`,
        [needle],
      );
      const stores = await tx.query<Store>(
        `SELECT id, user_id, name, description, location, logo_url, created_at FROM public.supplier_stores
         WHERE status = 'approved' ORDER BY created_at DESC LIMIT 60`,
      );
      // One store per owner (web, 2026-10): some owners have duplicate store rows; keep the newest.
      const seenOwners = new Set<string>();
      stores.rows = stores.rows.filter((s) => !seenOwners.has(s.user_id) && !!seenOwners.add(s.user_id));
      const cats = await tx.query<Cat>("SELECT id, code, name_en, name_km FROM public.supplier_categories ORDER BY name_en");
      const storeIds = stores.rows.map((s) => s.id);
      const storeCats = await tx.query<{ store_id: string; cat: Cat }>(
        `SELECT sc.store_id, json_build_object('id', c.id, 'code', c.code, 'name_en', c.name_en, 'name_km', c.name_km) AS cat
         FROM public.supplier_store_categories sc JOIN public.supplier_categories c ON c.id = sc.category_id
         WHERE sc.store_id = ANY($1)`,
        [storeIds],
      );
      const storePhotos = await tx.query<{ store_id: string; photo_url: string }>(
        "SELECT store_id, photo_url FROM public.supplier_store_photos WHERE store_id = ANY($1) ORDER BY sort_order",
        [storeIds],
      );
      const items = await tx.query<{
        id: string;
        store_id: string;
        name_en: string;
        note: string | null;
        price: number | null;
        offer_price: number | null;
        offer_active: boolean | null;
        currency: string | null;
        photo_url: string | null;
        category_id: string | null;
        created_at: string;
      }>(
        `SELECT id, store_id, name_en, note, price::float AS price, offer_price::float AS offer_price, offer_active, currency, photo_url, category_id, created_at
         FROM public.supplier_catalog_items WHERE store_id = ANY($1) ORDER BY created_at DESC LIMIT 60`,
        [storeIds],
      );
      const followers = await tx.query<{ store_id: string; follower_count: string }>("SELECT * FROM public.store_follower_counts($1)", [storeIds]);
      const mine = await tx.query("SELECT 1 FROM public.supplier_stores WHERE user_id = $1 LIMIT 1", [claims.sub]);
      return { posts: posts.rows, stores: stores.rows, cats: cats.rows, storeCats: storeCats.rows, storePhotos: storePhotos.rows, items: items.rows, followers: followers.rows, isSupplier: !!mine.rowCount };
    });

    // Assemble exactly like the web did.
    const catsByStore = new Map<string, Cat[]>();
    for (const r of data.storeCats) catsByStore.set(r.store_id, [...(catsByStore.get(r.store_id) ?? []), r.cat]);
    const photosByStore = new Map<string, string[]>();
    for (const p of data.storePhotos) photosByStore.set(p.store_id, [...(photosByStore.get(p.store_id) ?? []), p.photo_url]);
    const storeByUser = new Map(data.stores.map((s) => [s.user_id, s]));
    const storeById = new Map(data.stores.map((s) => [s.id, s]));
    const idByCode = new Map(data.cats.map((c) => [c.code, c.id]));

    const product = (st: Store | undefined) => ({
      store_name: st?.name ?? null,
      store_logo: st?.logo_url ?? null,
      store_location: st?.location ?? null,
      store_categories: st ? (catsByStore.get(st.id) ?? []) : [],
    });
    const postRows = data.posts.map((p) => {
      const st = storeByUser.get(p.user_id);
      return {
        id: p.id,
        user_id: p.user_id,
        title: p.title,
        content: p.content,
        price: p.price,
        discount_price: p.discount_price,
        currency: p.currency ?? "USD",
        post_type: p.post_type ?? "general",
        created_at: p.created_at,
        photo_url: p.photo_url,
        store_id: st?.id ?? null,
        ...product(st),
        cat_id: p.category ? (idByCode.get(p.category) ?? null) : null,
      };
    });
    const catalogRows = data.items.map((i) => {
      const st = storeById.get(i.store_id);
      const offer = (i.offer_active ?? false) && i.offer_price != null;
      return {
        id: i.id,
        // Same as the web: catalog rows carry the store id here (not the owner's user id).
        user_id: st?.id ?? i.store_id,
        title: i.name_en,
        content: i.note,
        price: offer ? i.offer_price : i.price,
        discount_price: offer ? i.price : null,
        currency: i.currency ?? "USD",
        post_type: "stock",
        created_at: i.created_at,
        photo_url: i.photo_url,
        store_id: i.store_id,
        ...product(st),
        cat_id: i.category_id ?? null,
      };
    });
    const products = [...postRows, ...catalogRows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const stores = data.stores.map((s) => ({ ...s, categories: catsByStore.get(s.id) ?? [], photos: (photosByStore.get(s.id) ?? []).slice(0, 3) }));
    const followerCounts = Object.fromEntries(data.followers.map((f) => [f.store_id, Number(f.follower_count)]));
    return c.json({ products, stores, categories: data.cats, followerCounts, isSupplier: data.isSupplier });
  })

  // Rent mode: approved rentals, newest 40, with owner and photos.
  .get("/rentals", async (c) => {
    const claims = c.get("claims")!;
    const rows = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT r.id, r.user_id, r.title, r.description, r.category, r.price_per_day::float AS price_per_day, r.currency, r.location,
           r.availability, r.available_from::text AS available_from,
           CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url) END AS profiles,
           COALESCE((SELECT json_agg(json_build_object('photo_url', ph.photo_url) ORDER BY ph.created_at)
                     FROM public.rental_photos ph WHERE ph.listing_id = r.id), '[]') AS rental_photos
         FROM public.rental_listings r LEFT JOIN public.profiles p ON p.id = r.user_id
         WHERE r.status = 'approved' ORDER BY r.created_at DESC LIMIT 40`,
      );
      return rows;
    });
    return c.json(rows);
  })

  // Rent → "Looking for": approved rental requests, newest 40.
  .get("/rental-requests", async (c) => {
    const claims = c.get("claims")!;
    const rows = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT r.id, r.user_id, r.title, r.description, r.category, r.location, r.budget_per_day::float AS budget_per_day, r.currency,
           r.needed_from::text AS needed_from, r.created_at,
           CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url) END AS profiles
         FROM public.rental_requests r LEFT JOIN public.profiles p ON p.id = r.user_id
         WHERE r.status = 'approved' ORDER BY r.created_at DESC LIMIT 40`,
      );
      return rows;
    });
    return c.json(rows);
  })

  // Retail / Second hand: active marketplace items of one kind, newest 60.
  .get("/items", zValidator("query", z.object({ kind: z.enum(["retail", "secondhand"]) })), async (c) => {
    const claims = c.get("claims")!;
    const { kind } = c.req.valid("query");
    const rows = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT m.id, m.user_id, m.kind, m.title, m.description, m.price::float AS price, m.currency, m.location, m.created_at,
           CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url) END AS profiles,
           COALESCE((SELECT json_agg(json_build_object('photo_url', ph.photo_url) ORDER BY ph.sort_order)
                     FROM public.marketplace_item_photos ph WHERE ph.item_id = m.id), '[]') AS marketplace_item_photos
         FROM public.marketplace_items m LEFT JOIN public.profiles p ON p.id = m.user_id
         WHERE m.kind = $1 AND m.status = 'active' ORDER BY m.created_at DESC LIMIT 60`,
        [kind],
      );
      return rows;
    });
    return c.json(rows);
  })

  // "Post my product" form options (web: routes/posts.new.tsx): active categories + catalogue products.
  .get("/product-options", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const cats = await tx.query<Cat>("SELECT id, code, name_en, name_km FROM public.supplier_categories WHERE is_active ORDER BY sort_order");
      const products = await tx.query(
        `SELECT id, category_id, name_en, name_km, unit, market_price_min::float AS market_price_min,
           market_price_max::float AS market_price_max, market_currency
         FROM public.catalog_products WHERE is_active ORDER BY sort_order`,
      );
      return { categories: cats.rows, products: products.rows };
    });
    return c.json(data);
  })

  // Submit a product post (web: routes/posts.new.tsx). Saved as "pending" for admin review, as on the web.
  .post(
    "/products",
    zValidator(
      "json",
      z.object({
        postType: z.enum(["general", "novedad", "stock", "oferta", "liquidacion"]),
        category: z.string().min(1).max(60),
        title: z.string().trim().min(1).max(120),
        price: z.number().nonnegative().nullable(),
        discountPrice: z.number().nonnegative().nullable(),
        currency: z.enum(["USD", "KHR"]),
        content: z.string().max(2000),
        videoUrl: z.string().url().nullable(),
        photos: z.array(z.string().url()).max(4),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      const id = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO public.posts (user_id, post_type, category, title, price, discount_price, currency, content, video_url, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending') RETURNING id`,
          [claims.sub, b.postType, b.category, b.title, b.price, b.discountPrice, b.currency, b.content, b.videoUrl],
        );
        if (b.photos.length)
          await tx.query("INSERT INTO public.post_photos (post_id, photo_url) SELECT $1, unnest($2::text[])", [rows[0].id, b.photos]);
        return rows[0].id;
      });
      return c.json({ id }, 201);
    },
  )

  // Sell an item (web: routes/marketplace.new.tsx). Goes live immediately ("active"), as on the web.
  .post(
    "/items",
    zValidator(
      "json",
      z.object({
        kind: z.enum(["retail", "secondhand"]),
        title: z.string().trim().min(1).max(120),
        description: z.string().max(1000).nullable(),
        price: z.number().nonnegative(),
        currency: z.enum(["USD", "KHR"]),
        location: z.string().max(120).nullable(),
        photos: z.array(z.string().url()).max(4),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      const id = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO public.marketplace_items (user_id, kind, title, description, price, currency, location, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') RETURNING id`,
          [claims.sub, b.kind, b.title, b.description?.trim() || null, b.price, b.currency, b.location?.trim() || null],
        );
        if (b.photos.length)
          await tx.query(
            "INSERT INTO public.marketplace_item_photos (item_id, photo_url, sort_order) SELECT $1, url, ord - 1 FROM unnest($2::text[]) WITH ORDINALITY AS t(url, ord)",
            [rows[0].id, b.photos],
          );
        return rows[0].id;
      });
      return c.json({ id }, 201);
    },
  )

  // Item page (web: routes/marketplace.$itemId.tsx). RLS shows active items, or any status to the owner.
  .get("/items/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const item = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT m.id, m.user_id, m.kind, m.title, m.description, m.price::float AS price, m.currency, m.location, m.status, m.created_at,
           CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url) END AS profiles,
           COALESCE((SELECT json_agg(json_build_object('photo_url', ph.photo_url) ORDER BY ph.sort_order)
                     FROM public.marketplace_item_photos ph WHERE ph.item_id = m.id), '[]') AS marketplace_item_photos
         FROM public.marketplace_items m LEFT JOIN public.profiles p ON p.id = m.user_id
         WHERE m.id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
    if (!item) return c.json({ error: "not_found" }, 404);
    return c.json(item);
  })

  // Owner: Mark as sold / Relist.
  .patch(
    "/items/:id/status",
    zValidator("param", z.object({ id: z.string().uuid() })),
    zValidator("json", z.object({ status: z.enum(["active", "sold"]) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { status } = c.req.valid("json");
      const n = await asUser(claims, async (_db, tx) =>
        (await tx.query("UPDATE public.marketplace_items SET status = $2 WHERE id = $1", [id, status])).rowCount,
      );
      if (!n) throw new HTTPException(403, { message: "forbidden" });
      return c.json({ ok: true });
    },
  )

  .delete("/items/:id", zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) => (await tx.query("DELETE FROM public.marketplace_items WHERE id = $1", [id])).rowCount);
    if (!n) throw new HTTPException(403, { message: "forbidden" });
    return c.json({ ok: true });
  })

  // "Ask about this": open/create the chat with the supplier pinned to the product (start_product_chat), count the contact.
  .post(
    "/product-chat",
    zValidator("json", z.object({ supplierId: z.string().uuid(), postId: z.string().uuid(), storeId: z.string().uuid() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { supplierId, postId, storeId } = c.req.valid("json");
      const threadId = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query<{ id: string }>("SELECT public.start_product_chat($1, $2) AS id", [supplierId, postId]);
        await tx.query("SELECT public.increment_supplier_contact($1)", [storeId]);
        return rows[0]?.id;
      });
      if (!threadId) throw new HTTPException(500, { message: "No thread" });
      return c.json({ threadId });
    },
  );
