// Find material (web: routes/find-material*.tsx): a buyer's material requests and the suppliers who said "available".
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

const idParam = z.object({ id: z.string().uuid() });

export const materialRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Number of my active requests (the entry page shows "n of 10").
  .get("/requests/active-count", async (c) => {
    const claims = c.get("claims")!;
    const count = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.material_requests WHERE user_id = $1 AND status = 'active'",
        [claims.sub],
      );
      return rows[0].n;
    });
    return c.json({ count });
  })

  // My searches: my active requests, newest first, each with the suppliers who answered "available".
  .get("/requests/mine", async (c) => {
    const claims = c.get("claims")!;
    const rows = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT r.id, r.category, r.quantity, r.note, r.status, r.created_at,
           COALESCE((SELECT json_agg(json_build_object(
                       'supplier_id', x.supplier_id,
                       'profile', (SELECT json_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url)
                                   FROM public.profiles p WHERE p.id = x.supplier_id)))
                     FROM public.material_request_responses x
                     WHERE x.request_id = r.id AND x.response = 'available'), '[]') AS responses
         FROM public.material_requests r
         WHERE r.user_id = $1 AND r.status = 'active'
         ORDER BY r.created_at DESC`,
        [claims.sub],
      );
      return rows;
    });
    return c.json(rows);
  })

  // New material search (web: find-material.new.tsx). DB triggers enforce the 10-active limit
  // ("active_request_limit_reached", returned as 400) and notify matching suppliers.
  .post(
    "/requests",
    zValidator(
      "json",
      z.object({
        category: z.enum(["electrical", "cement", "steel", "zinc", "tools", "timber", "sanitary", "paint", "other"]),
        quantity: z.number().int().positive(),
        note: z.string().max(400).nullable(),
        locationFilter: z.enum(["near_me", "anywhere"]),
        lat: z.number().nullable(),
        lng: z.number().nullable(),
        photos: z.array(z.string().url()).min(1).max(3),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      const id = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO public.material_requests (user_id, category, quantity, note, location_filter, lat, lng)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [claims.sub, b.category, b.quantity, b.note?.trim() || null, b.locationFilter, b.lat, b.lng],
        );
        await tx.query(
          "INSERT INTO public.material_request_photos (request_id, photo_url, sort_order) SELECT $1, url, ord - 1 FROM unnest($2::text[]) WITH ORDINALITY AS t(url, ord)",
          [rows[0].id, b.photos],
        );
        return rows[0].id;
      });
      return c.json({ id }, 201);
    },
  )

  // Picture search results (web: find-material.results.tsx): supplier product posts by id (picture match)
  // or whose title/content contains the query or any of its first 6 words, newest 40, with the approved store.
  .get(
    "/products",
    zValidator("query", z.object({ q: z.string().max(200).optional(), ids: z.string().max(800).optional() })),
    async (c) => {
      const claims = c.get("claims")!;
      const q = c.req.valid("query").q ?? "";
      const ids = (c.req.valid("query").ids ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        .slice(0, 8);
      const words = Array.from(
        new Set(
          q
            .replace(/[^\p{L}\p{N}\s-]/gu, " ")
            .split(/\s+/)
            .map((w) => w.trim())
            .filter((w) => w.length >= 2),
        ),
      ).slice(0, 6);
      const terms = [q.trim(), ...words].map((w) => w.replace(/[,%()]/g, " ").trim()).filter(Boolean);
      if (!ids.length && !terms.length) return c.json([]);
      const rows = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query(
          `SELECT p.id, p.title, p.content, p.price::float8 AS price, p.discount_price::float8 AS discount_price,
             COALESCE(p.currency, 'USD') AS currency, p.user_id,
             (SELECT ph.photo_url FROM public.post_photos ph WHERE ph.post_id = p.id ORDER BY ph.created_at LIMIT 1) AS photo_url,
             s.id AS store_id, s.name AS store_name
           FROM public.posts p
           LEFT JOIN LATERAL (SELECT id, name FROM public.supplier_stores
                              WHERE user_id = p.user_id AND status = 'approved' LIMIT 1) s ON true
           WHERE p.status = 'approved' AND p.post_type IN ('novedad', 'stock', 'oferta', 'liquidacion')
             AND (CASE WHEN cardinality($1::uuid[]) > 0 THEN p.id = ANY($1::uuid[])
                  ELSE EXISTS (SELECT 1 FROM unnest($2::text[]) t
                               WHERE strpos(lower(coalesce(p.title, '')), lower(t)) > 0
                                  OR strpos(lower(coalesce(p.content, '')), lower(t)) > 0) END)
           ORDER BY p.created_at DESC LIMIT 40`,
          [ids, terms],
        );
        return rows;
      });
      return c.json(rows);
    },
  )

  // "Found it · Cancel".
  .post("/requests/:id/cancel", zValidator("param", idParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) =>
      (await tx.query("UPDATE public.material_requests SET status = 'cancelled' WHERE id = $1", [id])).rowCount,
    );
    if (!n) throw new HTTPException(403, { message: "forbidden" });
    return c.json({ ok: true });
  })

  // Online orders (web: routes/online-orders.tsx), supplier side: my settings and the active requests
  // RLS lets me see (my categories and min quantity, plus my own requests, as the web query did),
  // each with the requester, photos and whether I already answered.
  .get("/supplier", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const settings = await tx.query<{ min_quantity: number; categories: string[] }>(
        "SELECT min_quantity, categories FROM public.supplier_settings WHERE supplier_id = $1",
        [claims.sub],
      );
      const { rows } = await tx.query(
        `SELECT r.id, r.user_id, r.category, r.quantity, r.note, r.created_at, r.location_filter,
           (SELECT json_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url)
              FROM public.profiles p WHERE p.id = r.user_id) AS profile,
           COALESCE((SELECT array_agg(ph.photo_url ORDER BY ph.sort_order)
                     FROM public.material_request_photos ph WHERE ph.request_id = r.id), '{}') AS photos,
           EXISTS (SELECT 1 FROM public.material_request_responses x
                   WHERE x.request_id = r.id AND x.supplier_id = $1) AS responded
         FROM public.material_requests r
         WHERE r.status = 'active'
         ORDER BY r.created_at DESC`,
        [claims.sub],
      );
      return { settings: settings.rows[0] ?? null, requests: rows };
    });
    return c.json(data);
  })

  .put(
    "/supplier/settings",
    zValidator(
      "json",
      z.object({
        minQuantity: z.number().int().min(1),
        categories: z.array(z.enum(["electrical", "cement", "steel", "zinc", "tools", "timber", "sanitary", "paint", "other"])).max(9),
      }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      await asUser(claims, (_db, tx) =>
        tx.query(
          `INSERT INTO public.supplier_settings (supplier_id, min_quantity, categories) VALUES ($1, $2, $3)
           ON CONFLICT (supplier_id) DO UPDATE SET min_quantity = EXCLUDED.min_quantity, categories = EXCLUDED.categories`,
          [claims.sub, b.minQuantity, b.categories],
        ),
      );
      return c.json({ ok: true });
    },
  )

  // Supplier answers a request. On "available" the app then opens the chat with /requests/:id/chat
  // (two steps, as on the web: the answer is kept even if the chat can't be started).
  .post(
    "/requests/:id/respond",
    zValidator("param", idParam),
    zValidator("json", z.object({ response: z.enum(["available", "unavailable"]) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { response } = c.req.valid("json");
      await asUser(claims, (_db, tx) =>
        tx.query("INSERT INTO public.material_request_responses (request_id, supplier_id, response) VALUES ($1, $2, $3)", [
          id,
          claims.sub,
          response,
        ]),
      );
      return c.json({ ok: true }, 201);
    },
  )

  // Chat with a supplier who answered (start_material_chat posts the request context once).
  .post(
    "/requests/:id/chat",
    zValidator("param", idParam),
    zValidator("json", z.object({ supplierId: z.string().uuid() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { supplierId } = c.req.valid("json");
      const threadId = await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query<{ id: string }>("SELECT public.start_material_chat($1, $2) AS id", [id, supplierId]);
        return rows[0]?.id;
      });
      if (!threadId) throw new HTTPException(500, { message: "No thread" });
      return c.json({ threadId });
    },
  );
