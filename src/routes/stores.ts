// Supplier store page (web: routes/suppliers.$storeId.tsx and components/StoreCatalog.tsx).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

const storeParam = z.object({ id: z.string().uuid() });
const itemParam = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });

type PostRow = {
  id: string;
  title: string | null;
  content: string | null;
  price: number | null;
  discount_price: number | null;
  currency: string | null;
  post_type: string | null;
  category: string | null;
  created_at: string;
  view_count: number | null;
  photo_url: string | null;
};
const POST_COLUMNS = `p.id, p.title, p.content, p.price::float AS price, p.discount_price::float AS discount_price, p.currency, p.post_type,
  p.category, p.created_at, p.view_count,
  (SELECT ph.photo_url FROM public.post_photos ph WHERE ph.post_id = p.id ORDER BY ph.created_at LIMIT 1) AS photo_url`;
/** The web counts a post as a "product" when it has a title, a price or a category. */
const isProductPost = (p: { title: string | null; price: number | null; category: string | null }) => !!(p.title || p.price != null || p.category);

export const storeRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Header, stats and "recent posts" (the non-product posts) of one store.
  .get("/:id", zValidator("param", storeParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const data = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT id, user_id, name, location, description, logo_url, view_count, contact_count, phone, fast_response, delivery_available,
           min_order::float AS min_order
         FROM public.supplier_stores WHERE id = $1`,
        [id],
      );
      const store = rows[0];
      if (!store) return null;
      const cats = await tx.query(
        `SELECT c.id, c.name_en, c.name_km FROM public.supplier_store_categories sc
         JOIN public.supplier_categories c ON c.id = sc.category_id WHERE sc.store_id = $1`,
        [id],
      );
      const photos = await tx.query<{ photo_url: string }>("SELECT photo_url FROM public.supplier_store_photos WHERE store_id = $1 ORDER BY sort_order", [id]);
      const postsCount = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM public.posts WHERE user_id = $1 AND status = 'approved'", [store.user_id]);
      const recent = await tx.query<PostRow>(
        `SELECT ${POST_COLUMNS} FROM public.posts p WHERE p.user_id = $1 AND p.status = 'approved' ORDER BY p.created_at DESC LIMIT 10`,
        [store.user_id],
      );
      const itemCount = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM public.supplier_catalog_items WHERE store_id = $1", [id]);
      const productPosts = await tx.query<{ title: string | null; price: number | null; category: string | null }>(
        "SELECT title, price, category FROM public.posts WHERE user_id = $1 AND status = 'approved' LIMIT 500",
        [store.user_id],
      );
      const followers = await tx.query<{ follower_count: string }>("SELECT * FROM public.store_follower_counts($1)", [[id]]);
      const following = await tx.query("SELECT 1 FROM public.store_followers WHERE store_id = $1 AND user_id = $2", [id, claims.sub]);
      const pending =
        store.user_id === claims.sub
          ? (
              await tx.query<{ n: number }>(
                "SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1 AND kind = 'material_request' AND read_at IS NULL",
                [claims.sub],
              )
            ).rows[0].n
          : 0;
      return {
        store,
        categories: cats.rows,
        photos: photos.rows.map((p) => p.photo_url),
        postsCount: postsCount.rows[0].n,
        catalogCount: itemCount.rows[0].n + productPosts.rows.filter(isProductPost).length,
        posts: recent.rows
          .filter((p) => !isProductPost(p))
          .map((p) => ({ ...p, currency: p.currency ?? "USD", post_type: p.post_type ?? "general", view_count: p.view_count ?? 0 })),
        followers: Number(followers.rows[0]?.follower_count ?? 0),
        following: !!following.rowCount,
        pendingRequests: pending,
      };
    });
    if (!data) throw new HTTPException(404, { message: "Not found" });
    return c.json(data);
  })

  // A visitor opened the page (the web calls increment_supplier_view for non-owners).
  .post("/:id/view", zValidator("param", storeParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    await asUser(claims, (_db, tx) => tx.query("SELECT public.increment_supplier_view($1)", [id]));
    return c.json({ ok: true });
  })

  .put("/:id/follow", zValidator("param", storeParam), zValidator("json", z.object({ following: z.boolean() })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const { following } = c.req.valid("json");
    await asUser(claims, async (_db, tx) => {
      if (following) await tx.query("INSERT INTO public.store_followers (store_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, claims.sub]);
      else await tx.query("DELETE FROM public.store_followers WHERE store_id = $1 AND user_id = $2", [id, claims.sub]);
    });
    return c.json({ ok: true });
  })

  // Owner deletes the store.
  .delete("/:id", zValidator("param", storeParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) => (await tx.query("DELETE FROM public.supplier_stores WHERE id = $1", [id])).rowCount);
    if (!n) throw new HTTPException(404, { message: "delete_failed" });
    return c.json({ ok: true });
  })

  // Chat with the store owner (optionally about one post), counted as a contact.
  .post("/:id/chat", zValidator("param", storeParam), zValidator("json", z.object({ postId: z.string().uuid().nullable().optional() })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const { postId } = c.req.valid("json");
    const threadId = await asUser(claims, async (_db, tx) => {
      const s = await tx.query<{ user_id: string }>("SELECT user_id FROM public.supplier_stores WHERE id = $1", [id]);
      if (!s.rows[0]) throw new HTTPException(404, { message: "Not found" });
      const { rows } = await tx.query<{ id: string }>("SELECT public.start_product_chat($1, $2) AS id", [s.rows[0].user_id, postId ?? null]);
      await tx.query("SELECT public.increment_supplier_contact($1)", [id]);
      return rows[0].id;
    });
    return c.json({ threadId });
  })

  // The public catalogue: catalogue items + product posts (duplicates of items hidden), categories, my stock alerts.
  .get("/:id/catalog", zValidator("param", storeParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const data = await asUser(claims, async (_db, tx) => {
      const cats = await tx.query("SELECT id, code, name_en, name_km FROM public.supplier_categories");
      const store = await tx.query<{ user_id: string }>("SELECT user_id FROM public.supplier_stores WHERE id = $1", [id]);
      const items = await tx.query(
        `SELECT id, name_en, name_km, note, unit, price::float AS price, currency, stock_status, stock_updated_at, in_stock, photo_url,
           offer_active, offer_price::float AS offer_price, category_id
         FROM public.supplier_catalog_items WHERE store_id = $1 ORDER BY created_at DESC`,
        [id],
      );
      const posts = store.rows[0]
        ? (
            await tx.query<PostRow>(
              `SELECT ${POST_COLUMNS} FROM public.posts p WHERE p.user_id = $1 AND p.status = 'approved' ORDER BY p.created_at DESC LIMIT 100`,
              [store.rows[0].user_id],
            )
          ).rows
        : [];
      const subs = await tx.query<{ item_id: string }>("SELECT item_id FROM public.catalog_stock_notifications WHERE store_id = $1 AND user_id = $2", [
        id,
        claims.sub,
      ]);
      return { cats: cats.rows, items: items.rows, posts, ownerId: store.rows[0]?.user_id ?? null, subscribed: subs.rows.map((s) => s.item_id) };
    });

    const byCode = new Map(data.cats.map((c) => [c.code as string, c.id as string]));
    const items = data.items.map((r) => {
      const offer = (r.offer_active ?? false) && r.offer_price != null;
      return {
        kind: "item" as const,
        id: r.id,
        name_en: r.name_en,
        name_km: r.name_km,
        note: r.note,
        unit: r.unit,
        price: offer ? r.offer_price : r.price,
        old_price: offer ? r.price : null,
        currency: r.currency ?? "USD",
        stock_status: r.stock_status ?? (r.in_stock ? "in_stock" : "out"),
        stock_updated_at: r.stock_updated_at,
        photo_url: r.photo_url,
        offer_active: r.offer_active ?? false,
        post_type: null,
        cat_id: r.category_id,
      };
    });
    const posts = data.posts.filter(isProductPost).map((p) => ({
      kind: "post" as const,
      id: p.id,
      name_en: p.title || p.content?.split("\n")[0] || "Product",
      name_km: null,
      note: p.title ? (p.content?.split("\n")[0] ?? null) : null,
      unit: null,
      price: p.discount_price ?? p.price,
      old_price: p.discount_price != null ? p.price : null,
      currency: p.currency ?? "USD",
      stock_status: null,
      stock_updated_at: p.created_at,
      photo_url: p.photo_url,
      offer_active: p.discount_price != null,
      post_type: p.post_type,
      cat_id: p.category ? (byCode.get(p.category) ?? null) : null,
    }));
    // Older product posts were copied into the catalogue, so hide the duplicate post entry.
    const itemNames = new Set(items.map((i) => String(i.name_en).trim().toLowerCase()));
    const deduped = posts.filter((p) => {
      const base = p.name_en.split(" - ")[0].trim().toLowerCase();
      return !itemNames.has(base) && !itemNames.has(p.name_en.trim().toLowerCase());
    });
    return c.json({ entries: [...items, ...deduped], categories: data.cats, subscribed: data.subscribed });
  })

  // Catalogue analytics events ("view" for the first 60 items a visitor sees, "chat" when they ask).
  .post(
    "/:id/catalog/events",
    zValidator("param", storeParam),
    zValidator("json", z.object({ itemIds: z.array(z.string().uuid()).min(1).max(60), type: z.enum(["view", "chat"]) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { itemIds, type } = c.req.valid("json");
      await asUser(claims, (_db, tx) =>
        tx.query("INSERT INTO public.catalog_item_events (item_id, store_id, user_id, event_type) SELECT unnest($1::uuid[]), $2, $3, $4", [itemIds, id, claims.sub, type]),
      );
      return c.json({ ok: true });
    },
  )

  // Name and owner only (web: catalog pages' small `supplier_stores` selects). 404 when RLS hides the store.
  .get("/:id/summary", zValidator("param", storeParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const store = await asUser(claims, async (_db, tx) =>
      (await tx.query("SELECT id, name, user_id FROM public.supplier_stores WHERE id = $1", [id])).rows[0],
    );
    if (!store) throw new HTTPException(404, { message: "Not found" });
    return c.json(store);
  })

  // Owner's "Add products" page (web: suppliers.$storeId.catalog.index.tsx): the newest 60 catalogue names.
  // `owner` is false for other users; the app sends them back to the store page, as the web did.
  .get("/:id/catalog/items", zValidator("param", storeParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const data = await asUser(claims, async (_db, tx) => {
      const s = await tx.query<{ user_id: string }>("SELECT user_id FROM public.supplier_stores WHERE id = $1", [id]);
      const owner = !s.rows[0] || s.rows[0].user_id === claims.sub;
      if (!owner) return { owner, items: [] };
      const { rows } = await tx.query(
        "SELECT id, name_en, name_km FROM public.supplier_catalog_items WHERE store_id = $1 ORDER BY created_at DESC LIMIT 60",
        [id],
      );
      return { owner, items: rows };
    });
    return c.json(data);
  })

  // Edit store form (web: suppliers.$storeId.edit.tsx): the store, its phone (`get_supplier_store_phone`), all
  // categories, the store's categories and featured photos. `owner` is false for other users (web: "Admins only").
  .get("/:id/edit", zValidator("param", storeParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const data = await asUser(claims, async (_db, tx) => {
      const s = await tx.query<{ user_id: string; name: string; location: string | null; description: string | null; logo_url: string | null }>(
        "SELECT user_id, name, location, description, logo_url FROM public.supplier_stores WHERE id = $1",
        [id],
      );
      const store = s.rows[0];
      if (!store || store.user_id !== claims.sub) return { owner: false as const };
      const phone = (await tx.query<{ p: string | null }>("SELECT public.get_supplier_store_phone($1) AS p", [id])).rows[0]?.p ?? null;
      const cats = await tx.query("SELECT id, name_en, name_km FROM public.supplier_categories ORDER BY sort_order");
      const mine = await tx.query<{ category_id: string }>("SELECT category_id FROM public.supplier_store_categories WHERE store_id = $1", [id]);
      const photos = await tx.query("SELECT id, photo_url AS url FROM public.supplier_store_photos WHERE store_id = $1 ORDER BY sort_order", [id]);
      return {
        owner: true as const,
        store: { name: store.name, location: store.location, description: store.description, logo_url: store.logo_url, phone },
        categories: cats.rows,
        selected: mine.rows.map((r) => r.category_id),
        photos: photos.rows,
      };
    });
    return c.json(data);
  })

  // Save the edit form in one transaction: store fields, categories (delete all, re-insert, as the web did),
  // removed photos, new photos appended after the kept ones.
  .put(
    "/:id",
    zValidator("param", storeParam),
    zValidator(
      "json",
      z.object({
        name: z.string().trim().min(1).max(120),
        location: z.string().max(120),
        description: z.string().max(150),
        phone: z.string().max(40),
        logoUrl: z.string().url().nullable(),
        categoryIds: z.array(z.string().uuid()).max(100),
        removedPhotoIds: z.array(z.string().uuid()).max(20),
        newPhotos: z.array(z.string().url()).max(5),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const b = c.req.valid("json");
      await asUser(claims, async (_db, tx) => {
        const upd = await tx.query(
          "UPDATE public.supplier_stores SET name = $3, location = $4, description = $5, phone = $6, logo_url = $7 WHERE id = $1 AND user_id = $2",
          [id, claims.sub, b.name, b.location.trim() || null, b.description.trim() || null, b.phone.trim() || null, b.logoUrl],
        );
        if (!upd.rowCount) throw new HTTPException(403, { message: "forbidden" });
        await tx.query("DELETE FROM public.supplier_store_categories WHERE store_id = $1", [id]);
        if (b.categoryIds.length)
          await tx.query("INSERT INTO public.supplier_store_categories (store_id, category_id) SELECT $1, unnest($2::uuid[])", [id, b.categoryIds]);
        if (b.removedPhotoIds.length)
          await tx.query("DELETE FROM public.supplier_store_photos WHERE store_id = $1 AND id = ANY($2::uuid[])", [id, b.removedPhotoIds]);
        if (b.newPhotos.length) {
          const kept = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM public.supplier_store_photos WHERE store_id = $1", [id])).rows[0].n;
          await tx.query(
            "INSERT INTO public.supplier_store_photos (store_id, photo_url, sort_order) SELECT $1, u, $3 + o - 1 FROM unnest($2::text[]) WITH ORDINALITY AS t(u, o)",
            [id, b.newPhotos, kept],
          );
        }
      });
      return c.json({ ok: true });
    },
  )

  // "Select from list" (web: suppliers.$storeId.catalog.list.tsx): active categories and products, plus the
  // product ids this store already has (shown with a ✓).
  .get("/:id/catalog/list-options", zValidator("param", storeParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const data = await asUser(claims, async (_db, tx) => {
      const cats = await tx.query("SELECT id, code, name_en, name_km FROM public.supplier_categories WHERE is_active ORDER BY sort_order");
      const products = await tx.query(
        `SELECT id, category_id, name_en, name_km, unit, market_price_min::float AS market_price_min,
           market_price_max::float AS market_price_max, market_currency
         FROM public.catalog_products WHERE is_active ORDER BY sort_order`,
      );
      const existing = await tx.query<{ product_id: string }>(
        "SELECT product_id FROM public.supplier_catalog_items WHERE store_id = $1 AND product_id IS NOT NULL",
        [id],
      );
      return { categories: cats.rows, products: products.rows, existing: existing.rows.map((r) => r.product_id) };
    });
    return c.json(data);
  })

  // Save the picked products, one row per product (upsert on store + product, as the web did).
  // Unit and category come from catalog_products, not from the client.
  .post(
    "/:id/catalog/items",
    zValidator("param", storeParam),
    zValidator(
      "json",
      z.object({
        items: z
          .array(
            z.object({
              productId: z.string().uuid(),
              nameEn: z.string().max(200),
              nameKm: z.string().max(200),
              price: z.number().nonnegative().nullable(),
              currency: z.enum(["USD", "KHR"]),
              stock: z.enum(["in_stock", "low", "out"]),
              note: z.string().max(2000).nullable(),
              photoUrl: z.string().url().nullable(),
            }),
          )
          .min(1)
          .max(500),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { items } = c.req.valid("json");
      await asUser(claims, async (_db, tx) => {
        for (const it of items) {
          await tx.query(
            `INSERT INTO public.supplier_catalog_items
               (store_id, product_id, category_id, name_en, name_km, unit, price, currency, stock_status, in_stock, note, photo_url, source)
             SELECT $1, p.id, p.category_id, COALESCE(NULLIF(btrim($3), ''), p.name_en), COALESCE(NULLIF(btrim($4), ''), p.name_km), p.unit,
               $5, $6, $7, $7 <> 'out', $8, $9, 'list'
             FROM public.catalog_products p WHERE p.id = $2
             ON CONFLICT (store_id, product_id) DO UPDATE SET
               category_id = EXCLUDED.category_id, name_en = EXCLUDED.name_en, name_km = EXCLUDED.name_km, unit = EXCLUDED.unit,
               price = EXCLUDED.price, currency = EXCLUDED.currency, stock_status = EXCLUDED.stock_status, in_stock = EXCLUDED.in_stock,
               note = EXCLUDED.note, photo_url = EXCLUDED.photo_url, source = EXCLUDED.source`,
            [id, it.productId, it.nameEn, it.nameKm, it.price, it.currency, it.stock, it.note?.trim() || null, it.photoUrl],
          );
        }
      });
      return c.json({ ok: true }, 201);
    },
  )

  // Products found by the AI (web: catalog.import.tsx and catalog.photo.tsx inserted them straight into
  // supplier_catalog_items): free names, category by its code, source "import" or "photo". RLS = owner only.
  .post(
    "/:id/catalog/custom-items",
    zValidator("param", storeParam),
    zValidator(
      "json",
      z.object({
        source: z.enum(["import", "photo"]),
        items: z
          .array(
            z.object({
              nameEn: z.string().trim().min(1).max(200),
              nameKm: z.string().max(200).nullable(),
              unit: z.string().trim().max(20),
              categoryCode: z.string().max(40),
              price: z.number().nonnegative().nullable(),
              currency: z.enum(["USD", "KHR"]),
              stock: z.enum(["in_stock", "out"]),
              note: z.string().max(2000).nullable(),
              photoUrl: z.string().url().nullable(),
            }),
          )
          .min(1)
          .max(60),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { source, items } = c.req.valid("json");
      await asUser(claims, async (_db, tx) => {
        for (const it of items) {
          await tx.query(
            `INSERT INTO public.supplier_catalog_items
               (store_id, category_id, name_en, name_km, unit, price, currency, stock_status, in_stock, note, photo_url, source)
             VALUES ($1, (SELECT id FROM public.supplier_categories WHERE code = $2), $3, NULLIF(btrim($4), ''), COALESCE(NULLIF($5, ''), 'unit'),
               $6, $7, $8, $8 <> 'out', NULLIF(btrim($9), ''), $10, $11)`,
            [id, it.categoryCode, it.nameEn, it.nameKm ?? "", it.unit, it.price, it.currency, it.stock, it.note ?? "", it.photoUrl, source],
          );
        }
      });
      return c.json({ ok: true }, 201);
    },
  )

  // Owner panel (web: suppliers.$storeId.catalog.manage.tsx): store, followers, every item with its market range
  // and category, `catalog_panel_stats` and the week's most searched terms in the store's province.
  .get("/:id/catalog/panel", zValidator("param", storeParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const data = await asUser(claims, async (_db, tx) => {
      const s = await tx.query<{ user_id: string; name: string; location: string | null; view_count: number | null }>(
        "SELECT user_id, name, location, view_count FROM public.supplier_stores WHERE id = $1",
        [id],
      );
      const store = s.rows[0];
      if (store && store.user_id !== claims.sub) return { owner: false as const };
      const items = await tx.query(
        `SELECT i.id, i.name_en, i.name_km, i.unit, i.price::float AS price, COALESCE(i.currency, 'USD') AS currency,
           COALESCE(i.stock_status, CASE WHEN i.in_stock THEN 'in_stock' ELSE 'out' END) AS stock_status,
           i.photo_url, i.category_id, COALESCE(i.offer_active, false) AS offer_active, i.offer_price::float AS offer_price,
           cp.market_price_min::float AS market_min, cp.market_price_max::float AS market_max,
           CASE WHEN sc.id IS NULL THEN NULL ELSE json_build_object('id', sc.id, 'name_en', sc.name_en, 'name_km', sc.name_km) END AS category
         FROM public.supplier_catalog_items i
         LEFT JOIN public.catalog_products cp ON cp.id = i.product_id
         LEFT JOIN public.supplier_categories sc ON sc.id = i.category_id
         WHERE i.store_id = $1 ORDER BY i.created_at DESC`,
        [id],
      );
      const stats = store ? (await tx.query("SELECT public.catalog_panel_stats($1) AS s", [id])).rows[0].s : null;
      const market = await tx.query("SELECT term, search_count::int AS search_count FROM public.catalog_market_searches($1, 6)", [
        store?.location ?? null,
      ]);
      const followers = await tx.query<{ follower_count: string }>("SELECT * FROM public.store_follower_counts($1)", [[id]]);
      return {
        owner: true as const,
        name: store?.name ?? "",
        views: store?.view_count ?? 0,
        followers: Number(followers.rows[0]?.follower_count ?? 0),
        items: items.rows,
        stats,
        market: market.rows,
      };
    });
    return c.json(data);
  })

  // Owner stats page (web: suppliers.$storeId.catalog.stats.tsx): `catalog_stats` for the last 7 / 30 / 90 days.
  .get(
    "/:id/catalog/stats",
    zValidator("param", storeParam),
    zValidator("query", z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d)) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { days } = c.req.valid("query");
      const data = await asUser(claims, async (_db, tx) => {
        const s = await tx.query<{ user_id: string }>("SELECT user_id FROM public.supplier_stores WHERE id = $1", [id]);
        if (s.rows[0] && s.rows[0].user_id !== claims.sub) return { owner: false as const };
        const stats = (await tx.query("SELECT public.catalog_stats($1, $2) AS s", [id, days])).rows[0].s;
        return { owner: true as const, stats };
      });
      return c.json(data);
    },
  )

  // Owner edits one item: stock status (cycled on the panel) or the offer.
  .patch(
    "/:id/catalog/:itemId",
    zValidator("param", itemParam),
    zValidator(
      "json",
      z.union([
        z.object({ stockStatus: z.enum(["in_stock", "low", "out"]) }),
        z.object({ offerActive: z.boolean(), offerPrice: z.number().nonnegative().nullable() }),
      ]),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const { id, itemId } = c.req.valid("param");
      const b = c.req.valid("json");
      const n = await asUser(claims, async (_db, tx) =>
        "stockStatus" in b
          ? (
              await tx.query("UPDATE public.supplier_catalog_items SET stock_status = $3, in_stock = $3 <> 'out' WHERE id = $1 AND store_id = $2", [
                itemId,
                id,
                b.stockStatus,
              ])
            ).rowCount
          : (
              await tx.query("UPDATE public.supplier_catalog_items SET offer_active = $3, offer_price = $4 WHERE id = $1 AND store_id = $2", [
                itemId,
                id,
                b.offerActive,
                b.offerActive ? b.offerPrice : null,
              ])
            ).rowCount,
      );
      if (!n) throw new HTTPException(403, { message: "forbidden" });
      return c.json({ ok: true });
    },
  )

  .delete("/:id/catalog/:itemId", zValidator("param", itemParam), async (c) => {
    const claims = c.get("claims")!;
    const { id, itemId } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) =>
      (await tx.query("DELETE FROM public.supplier_catalog_items WHERE id = $1 AND store_id = $2", [itemId, id])).rowCount,
    );
    if (!n) throw new HTTPException(403, { message: "forbidden" });
    return c.json({ ok: true });
  })

  // "Notify me" when an out-of-stock item is back.
  .put("/:id/catalog/:itemId/notify", zValidator("param", itemParam), zValidator("json", z.object({ on: z.boolean() })), async (c) => {
    const claims = c.get("claims")!;
    const { id, itemId } = c.req.valid("param");
    const { on } = c.req.valid("json");
    await asUser(claims, async (_db, tx) => {
      if (on) await tx.query("INSERT INTO public.catalog_stock_notifications (item_id, store_id, user_id) VALUES ($1, $2, $3)", [itemId, id, claims.sub]);
      else await tx.query("DELETE FROM public.catalog_stock_notifications WHERE item_id = $1 AND user_id = $2", [itemId, claims.sub]);
    });
    return c.json({ ok: true });
  })

  // Report a wrong price / unavailable item. A second report of the same item gives 409 (web: "report_already").
  .post(
    "/:id/catalog/:itemId/report",
    zValidator("param", itemParam),
    zValidator("json", z.object({ reason: z.enum(["unavailable", "price", "closed", "other"]), note: z.string().max(400).optional() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id, itemId } = c.req.valid("param");
      const { reason, note } = c.req.valid("json");
      try {
        await asUser(claims, (_db, tx) =>
          tx.query("INSERT INTO public.catalog_stock_reports (item_id, store_id, user_id, reason, note) VALUES ($1, $2, $3, $4, $5)", [
            itemId,
            id,
            claims.sub,
            reason,
            note?.trim() || null,
          ]),
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new HTTPException(409, { message: "report_already" });
        throw e;
      }
      return c.json({ ok: true }, 201);
    },
  );
