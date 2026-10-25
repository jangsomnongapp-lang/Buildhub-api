// Admin screens (web: routes/admin.*.tsx). Every route checks is_admin first (web: RequireAdmin + verifyAdmin),
// then runs as the user so the admin RLS policies decide, as they did on the web.
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asUser, pool } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  const { rows } = await pool.query<{ is_admin: boolean }>("SELECT is_admin FROM public.profiles WHERE id = $1", [c.get("claims")!.sub]);
  if (!rows[0]?.is_admin) throw new HTTPException(403, { message: "Admin only" });
  await next();
});

const idParam = z.object({ id: z.string().uuid() });
/** Tables the content review can change (validated, then used as the table name). */
const contentKind = z.enum(["posts", "stories", "listings", "rental_listings", "rental_requests"]);

export const adminRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth, requireAdmin)

  // RequireAdmin's check.
  .get("/check", (c) => c.json({ isAdmin: true }))

  // Review reports (web: admin.reports.tsx).
  .get("/reports", zValidator("query", z.object({ status: z.enum(["open", "resolved", "dismissed"]) })), async (c) => {
    const claims = c.get("claims")!;
    const { status } = c.req.valid("query");
    const rows = await asUser(claims, async (_db, tx) =>
      (
        await tx.query(
          "SELECT id, reporter_id, target_kind, target_id, reason, status, created_at FROM public.reports WHERE status = $1 ORDER BY created_at DESC",
          [status],
        )
      ).rows,
    );
    return c.json(rows);
  })

  // Clients' catalogue stock reports, newest 100 (internal only, suppliers never see them).
  .get("/reports/stock", async (c) => {
    const claims = c.get("claims")!;
    const rows = await asUser(claims, async (_db, tx) =>
      (
        await tx.query(
          `SELECT r.id, r.reason, r.note, r.created_at, i.name_en AS item_name, s.name AS store_name
           FROM public.catalog_stock_reports r
           LEFT JOIN public.supplier_catalog_items i ON i.id = r.item_id
           LEFT JOIN public.supplier_stores s ON s.id = r.store_id
           ORDER BY r.created_at DESC LIMIT 100`,
        )
      ).rows,
    );
    return c.json(rows);
  })

  .patch("/reports/:id", zValidator("param", idParam), zValidator("json", z.object({ status: z.enum(["resolved", "dismissed"]) })), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const n = await asUser(claims, async (_db, tx) => (await tx.query("UPDATE public.reports SET status = $2 WHERE id = $1", [id, status])).rowCount);
    if (!n) throw new HTTPException(404, { message: "Not found" });
    return c.json({ ok: true });
  })

  // Suppliers (web: admin.suppliers.tsx): invite links and every store.
  .get("/suppliers", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const invites = await tx.query("SELECT id, token, note, used_by, used_at, created_at FROM public.supplier_invites ORDER BY created_at DESC");
      const stores = await tx.query("SELECT id, name, location, status, created_at FROM public.supplier_stores ORDER BY created_at DESC");
      return { invites: invites.rows, stores: stores.rows };
    });
    return c.json(data);
  })

  // New one-time supplier invite; the link is /supplier/join/<token> (16 hex characters, as on the web).
  .post("/suppliers/invites", zValidator("json", z.object({ note: z.string().max(200).optional() })), async (c) => {
    const claims = c.get("claims")!;
    const { note } = c.req.valid("json");
    const token = randomUUID().replace(/-/g, "").slice(0, 16);
    await asUser(claims, (_db, tx) =>
      tx.query("INSERT INTO public.supplier_invites (token, note, created_by) VALUES ($1, $2, $3)", [token, note?.trim() || null, claims.sub]),
    );
    return c.json({ token }, 201);
  })

  .patch(
    "/suppliers/stores/:id",
    zValidator("param", idParam),
    zValidator("json", z.object({ status: z.enum(["approved", "rejected"]) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { status } = c.req.valid("json");
      const n = await asUser(claims, async (_db, tx) => (await tx.query("UPDATE public.supplier_stores SET status = $2 WHERE id = $1", [id, status])).rowCount);
      if (!n) throw new HTTPException(404, { message: "Not found" });
      return c.json({ ok: true });
    },
  )

  // Telegram notifications (web: admin.telegram.tsx). The secret is never read back (hidden from client
  // roles); it's only written when the admin enters a new one.
  .get("/telegram", async (c) => {
    const claims = c.get("claims")!;
    const row = await asUser(claims, async (_db, tx) =>
      (await tx.query("SELECT telegram_chat_id, telegram_webhook_url FROM public.app_settings_public WHERE id = 1")).rows[0] ?? null,
    );
    return c.json(row ?? { telegram_chat_id: null, telegram_webhook_url: null });
  })

  .put(
    "/telegram",
    zValidator(
      "json",
      z.object({ chatId: z.string().max(100), webhookUrl: z.string().max(500), secret: z.string().max(200).optional() }),
    ),
    async (c) => {
      const claims = c.get("claims")!;
      const b = c.req.valid("json");
      const secret = b.secret?.trim();
      await asUser(claims, (_db, tx) =>
        secret
          ? tx.query(
              `INSERT INTO public.app_settings (id, telegram_chat_id, telegram_webhook_url, telegram_webhook_secret, updated_at) VALUES (1, $1, $2, $3, now())
               ON CONFLICT (id) DO UPDATE SET telegram_chat_id = EXCLUDED.telegram_chat_id, telegram_webhook_url = EXCLUDED.telegram_webhook_url,
                 telegram_webhook_secret = EXCLUDED.telegram_webhook_secret, updated_at = now()`,
              [b.chatId.trim() || null, b.webhookUrl.trim() || null, secret],
            )
          : tx.query(
              `INSERT INTO public.app_settings (id, telegram_chat_id, telegram_webhook_url, updated_at) VALUES (1, $1, $2, now())
               ON CONFLICT (id) DO UPDATE SET telegram_chat_id = EXCLUDED.telegram_chat_id, telegram_webhook_url = EXCLUDED.telegram_webhook_url, updated_at = now()`,
              [b.chatId.trim() || null, b.webhookUrl.trim() || null],
            ),
      );
      return c.json({ ok: true });
    },
  )

  // Invitations (web: admin.invitations.tsx): clicks and joins per inviter for this month / last month / all time
  // (months in Cambodia time; the web used the browser's), lifetime joins for the next tier, and each user's rewards.
  .get("/invitations", zValidator("query", z.object({ period: z.enum(["month", "prev", "all"]) })), async (c) => {
    const claims = c.get("claims")!;
    const { period } = c.req.valid("query");
    const month = "date_trunc('month', now() AT TIME ZONE 'Asia/Phnom_Penh')";
    const range =
      period === "all"
        ? "true"
        : period === "month"
          ? `created_at >= ${month} AT TIME ZONE 'Asia/Phnom_Penh' AND created_at < (${month} + interval '1 month') AT TIME ZONE 'Asia/Phnom_Penh'`
          : `created_at >= (${month} - interval '1 month') AT TIME ZONE 'Asia/Phnom_Penh' AND created_at < ${month} AT TIME ZONE 'Asia/Phnom_Penh'`;
    const rows = await asUser(claims, async (_db, tx) =>
      (
        await tx.query(
          `WITH clicks AS (SELECT inviter_id, count(*)::int AS n FROM public.invite_clicks WHERE ${range} GROUP BY inviter_id),
                joins AS (SELECT inviter_id, count(*)::int AS n FROM public.invite_joins WHERE ${range} GROUP BY inviter_id),
                lifetime AS (SELECT inviter_id, count(*)::int AS n FROM public.invite_joins GROUP BY inviter_id),
                ids AS (SELECT inviter_id FROM clicks UNION SELECT inviter_id FROM joins UNION SELECT inviter_id FROM lifetime)
           SELECT ids.inviter_id AS user_id, p.full_name, p.avatar_url,
             COALESCE(clicks.n, 0) AS sent, COALESCE(joins.n, 0) AS joined, COALESCE(lifetime.n, 0) AS lifetime_joined,
             (SELECT json_build_object('id', r.id, 'tier', r.tier) FROM public.invite_rewards r
               WHERE r.user_id = ids.inviter_id AND r.status = 'pending' ORDER BY r.tier LIMIT 1) AS pending_reward,
             COALESCE((SELECT array_agg(r.tier) FROM public.invite_rewards r WHERE r.user_id = ids.inviter_id AND r.status = 'sent'), '{}') AS sent_reward_tiers
           FROM ids
           LEFT JOIN clicks ON clicks.inviter_id = ids.inviter_id
           LEFT JOIN joins ON joins.inviter_id = ids.inviter_id
           LEFT JOIN lifetime ON lifetime.inviter_id = ids.inviter_id
           LEFT JOIN public.profiles p ON p.id = ids.inviter_id
           ORDER BY joined DESC`,
        )
      ).rows,
    );
    return c.json(rows);
  })

  // Mark a reward delivered (port of markRewardSent) and grant the matching badge for 5 / 25 / 50.
  .post("/invitations/rewards/:id/sent", zValidator("param", idParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const tier = await asUser(claims, async (_db, tx) => {
      const r = await tx.query<{ user_id: string; tier: number }>(
        "UPDATE public.invite_rewards SET status = 'sent', sent_at = now() WHERE id = $1 RETURNING user_id, tier",
        [id],
      );
      const reward = r.rows[0];
      if (!reward) throw new HTTPException(404, { message: "Reward not found" });
      const flag = reward.tier === 5 ? "is_verified" : reward.tier === 25 ? "is_recruiter" : reward.tier === 50 ? "is_featured" : null;
      if (flag) await tx.query(`UPDATE public.profiles SET ${flag} = true WHERE id = $1`, [reward.user_id]);
      return reward.tier;
    });
    return c.json({ ok: true, tier });
  })

  // Lottery draws (web: admin.draws.tsx + lib/admin-draws.functions.ts): the newest 50 draws with winner names.
  .get("/draws", async (c) => {
    const claims = c.get("claims")!;
    const rows = await asUser(claims, async (_db, tx) =>
      (
        await tx.query(
          `SELECT d.id, d.draw_type, d.draw_date::text AS draw_date, d.prize_title, d.status, d.winner_user_id, d.winning_ticket_id,
             d.drawn_at, d.published_at, p.full_name AS winner_name
           FROM public.lottery_draws d LEFT JOIN public.profiles p ON p.id = d.winner_user_id
           ORDER BY d.draw_date DESC LIMIT 50`,
        )
      ).rows,
    );
    return c.json(rows);
  })

  // Active tickets in one draw period.
  .get(
    "/draws/participants",
    zValidator("query", z.object({ type: z.enum(["daily", "weekly", "monthly"]), start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { type, start } = c.req.valid("query");
      const n = await asUser(claims, async (_db, tx) =>
        (
          await tx.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM public.lottery_tickets WHERE ticket_type = $1 AND draw_period_start = $2 AND status = 'active'",
            [type, start],
          )
        ).rows[0].n,
      );
      return c.json({ count: n });
    },
  )

  // The three actions below ran with the service key on the web (after its admin check), so they use the owner pool.
  .post("/draws/sync", async (c) => {
    await pool.query("SELECT public.ensure_scheduled_draws()");
    return c.json({ ok: true });
  })

  .post("/draws/:id/run", zValidator("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const { rows } = await pool.query<{ r: { ok: boolean; reason?: string } }>("SELECT public.run_lottery_draw($1) AS r", [id]);
    return c.json(rows[0].r);
  })

  .post(
    "/draws/:id/manual",
    zValidator("param", idParam),
    zValidator(
      "json",
      z.object({
        drawType: z.enum(["daily", "weekly", "monthly"]),
        drawPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        ticketNumber: z.number().int().positive(),
      }),
    ),
    async (c) => {
      const { id } = c.req.valid("param");
      const b = c.req.valid("json");
      const t = await pool.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM public.lottery_tickets
         WHERE ticket_type = $1 AND draw_period_start = $2 AND ticket_number = $3 AND status = 'active' LIMIT 1`,
        [b.drawType, b.drawPeriodStart, b.ticketNumber],
      );
      const ticket = t.rows[0];
      if (!ticket) throw new HTTPException(400, { message: "Ticket not found for this draw period" });
      await pool.query("UPDATE public.lottery_draws SET winner_user_id = $2, winning_ticket_id = $3, status = 'drawn', drawn_at = now() WHERE id = $1", [
        id,
        ticket.user_id,
        ticket.id,
      ]);
      return c.json({ ok: true });
    },
  )

  // Review content (web: admin.posts.tsx): pending (or approved) posts, stories, listings, rentals and rental
  // requests, newest first, with author and up to 4 photos each. Listings use "active" for approved.
  .get("/content", zValidator("query", z.object({ view: z.enum(["pending", "approved"]) })), async (c) => {
    const claims = c.get("claims")!;
    const { view } = c.req.valid("query");
    const st = view === "pending" ? "pending" : "approved";
    const listingSt = view === "pending" ? "pending" : "active";
    const author = `(SELECT json_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url) FROM public.profiles p WHERE p.id = x.user_id) AS profiles`;
    const photos = (table: string, fk: string) =>
      `COALESCE((SELECT json_agg(ph.photo_url ORDER BY ph.created_at) FROM (SELECT photo_url, created_at FROM public.${table} WHERE ${fk} = x.id ORDER BY created_at LIMIT 4) ph), '[]') AS photos`;
    const data = await asUser(claims, async (_db, tx) => {
      const q = (sql: string, status: string) => tx.query(sql, [status]).then((r) => r.rows);
      return {
        posts: await q(
          `SELECT x.id, x.user_id, x.content, x.video_url, x.created_at, x.status, ${author}, ${photos("post_photos", "post_id")}
           FROM public.posts x WHERE x.status = $1 ORDER BY x.created_at DESC`,
          st,
        ),
        stories: await q(
          `SELECT x.id, x.user_id, x.media_url, x.caption, x.created_at, x.status, ${author}
           FROM public.stories x WHERE x.status = $1 ORDER BY x.created_at DESC`,
          st,
        ),
        listings: await q(
          `SELECT x.id, x.user_id, x.title, x.description, x.budget::float AS budget, x.currency, x.location, x.created_at, x.status, ${author},
             ${photos("listing_photos", "listing_id")}
           FROM public.listings x WHERE x.status = $1 ORDER BY x.created_at DESC`,
          listingSt,
        ),
        rentals: await q(
          `SELECT x.id, x.user_id, x.title, x.description, x.category, x.price_per_day::float AS price_per_day, x.currency, x.location,
             x.created_at, x.status, ${author}, ${photos("rental_photos", "listing_id")}
           FROM public.rental_listings x WHERE x.status = $1 ORDER BY x.created_at DESC`,
          st,
        ),
        requests: await q(
          `SELECT x.id, x.user_id, x.title, x.description, x.category, x.location, x.budget_per_day::float AS budget_per_day, x.currency,
             x.needed_from::text AS needed_from, x.created_at, x.status, ${author}
           FROM public.rental_requests x WHERE x.status = $1 ORDER BY x.created_at DESC`,
          st,
        ),
      };
    });
    return c.json(data);
  })

  // Approve / reject. Posts, stories and listings also set or clear rejected_at, as on the web.
  .patch(
    "/content/:kind/:id",
    zValidator("param", z.object({ kind: contentKind, id: z.string().uuid() })),
    zValidator("json", z.object({ decision: z.enum(["approved", "rejected"]) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { kind, id } = c.req.valid("param");
      const { decision } = c.req.valid("json");
      const status = decision === "rejected" ? "rejected" : kind === "listings" ? "active" : "approved";
      const hasRejectedAt = kind === "posts" || kind === "stories" || kind === "listings";
      const n = await asUser(claims, async (_db, tx) =>
        (
          await tx.query(
            hasRejectedAt
              ? `UPDATE public.${kind} SET status = $2, rejected_at = CASE WHEN $2 = 'rejected' THEN now() END WHERE id = $1`
              : `UPDATE public.${kind} SET status = $2 WHERE id = $1`,
            [id, status],
          )
        ).rowCount,
      );
      if (!n) throw new HTTPException(404, { message: "Not found" });
      return c.json({ ok: true });
    },
  )

  .delete("/content/:kind/:id", zValidator("param", z.object({ kind: contentKind, id: z.string().uuid() })), async (c) => {
    const claims = c.get("claims")!;
    const { kind, id } = c.req.valid("param");
    const n = await asUser(claims, async (_db, tx) => (await tx.query(`DELETE FROM public.${kind} WHERE id = $1`, [id])).rowCount);
    if (!n) throw new HTTPException(404, { message: "Not found" });
    return c.json({ ok: true });
  });
