import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

export const meRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Everything the app frame (AppShell) needs: header bell badge, Messages badge, My store button.
  // Same three queries the web AppShell ran against Supabase.
  .get("/shell", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query<{ unread_alerts: number; unread_messages: number; my_store_id: string | null }>(
        `SELECT
           (SELECT count(*)::int FROM public.notifications WHERE user_id = $1 AND read_at IS NULL) AS unread_alerts,
           COALESCE(public.unread_message_count($1), 0)::int AS unread_messages,
           (SELECT id FROM public.supplier_stores WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1) AS my_store_id`,
        [claims.sub],
      );
      return rows[0];
    });
    return c.json({ unreadAlerts: data.unread_alerts, unreadMessages: data.unread_messages, myStoreId: data.my_store_id });
  })

  // The app's Expo push token. Same upsert as the web's expoPushToken.ts (one row per user + token);
  // the DB triggers queue a push for every token of the recipient, and src/jobs/push.ts sends them.
  .put(
    "/device-token",
    zValidator("json", z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[.+\]$/).max(200), platform: z.string().trim().max(200) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { token, platform } = c.req.valid("json");
      await asUser(claims, (_db, tx) =>
        tx.query(
          `INSERT INTO public.device_tokens (user_id, token, platform, provider, updated_at)
           VALUES ($1, $2, $3, 'expo', now())
           ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, provider = 'expo', updated_at = now()`,
          [claims.sub, token, platform.toLowerCase() || "unknown"],
        ),
      );
      return c.json({ ok: true });
    },
  )

  // Sign-out removes this phone's token, so a signed-out phone stops getting the account's pushes.
  // (Not in the web: it never removed tokens.)
  .delete("/device-token", zValidator("json", z.object({ token: z.string().min(1).max(200) })), async (c) => {
    const claims = c.get("claims")!;
    await asUser(claims, (_db, tx) =>
      tx.query("DELETE FROM public.device_tokens WHERE user_id = $1 AND token = $2", [claims.sub, c.req.valid("json").token]),
    );
    return c.json({ ok: true });
  })

  // Job alerts (sql/007_job_alerts.sql; not in the web). No row yet = on, but no provinces picked.
  .get("/job-alerts", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const s = (
        await tx.query<{ enabled: boolean; provinces: string[] }>(
          "SELECT enabled, provinces FROM public.job_alert_settings WHERE user_id = $1",
          [claims.sub],
        )
      ).rows[0];
      const skills = (
        await tx.query<{ id: string; name_en: string; name_km: string }>(
          `SELECT c.id, c.name_en, c.name_km FROM public.user_categories uc
           JOIN public.categories c ON c.id = uc.category_id
           WHERE uc.user_id = $1 ORDER BY c.sort_order, c.name_en`,
          [claims.sub],
        )
      ).rows;
      return { enabled: s?.enabled ?? true, provinces: s?.provinces ?? [], skills };
    });
    return c.json(data);
  })

  .put(
    "/job-alerts",
    zValidator("json", z.object({ enabled: z.boolean(), provinces: z.array(z.string().trim().min(1).max(60)).max(30) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { enabled, provinces } = c.req.valid("json");
      await asUser(claims, (_db, tx) =>
        tx.query(
          `INSERT INTO public.job_alert_settings (user_id, enabled, provinces, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, provinces = EXCLUDED.provinces, updated_at = now()`,
          [claims.sub, enabled, [...new Set(provinces)]],
        ),
      );
      return c.json({ ok: true });
    },
  );
