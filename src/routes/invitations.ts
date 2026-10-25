// My invitations (web: routes/invitations.tsx + lib/invite-rewards.functions.ts claimInviteRewards).
import { Hono } from "hono";
import { asUser, pool } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

const TIERS = [5, 25, 50, 100] as const;

/** Same shape as the web's generateCode: 6 characters of the user id + 4 random base-36 characters. */
function generateCode(userId: string): string {
  const seed = userId.replace(/-/g, "").slice(0, 6);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${seed}${rand}`.toLowerCase();
}

export const invitationRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Invite code (created on first visit), clicks, joins, joins this month and the month's top 10.
  // All through RLS like the web: invite_joins is readable only for your own rows (admins see all),
  // so for normal users the "top this month" list only ever contains themselves (as on the live site).
  // "This month" starts on the 1st in Cambodia time (the web used the browser's local time).
  .get("/", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      let code = (await tx.query<{ code: string }>("SELECT code FROM public.invite_codes WHERE user_id = $1", [claims.sub])).rows[0]?.code ?? null;
      if (!code) {
        await tx.query("SAVEPOINT code");
        try {
          code = (await tx.query<{ code: string }>("INSERT INTO public.invite_codes (user_id, code) VALUES ($1, $2) RETURNING code", [claims.sub, generateCode(claims.sub)]))
            .rows[0].code;
        } catch {
          // The web ignored a failed insert and showed "..." for the link.
          await tx.query("ROLLBACK TO SAVEPOINT code");
        }
      }
      const monthStart = "date_trunc('month', now() AT TIME ZONE 'Asia/Phnom_Penh') AT TIME ZONE 'Asia/Phnom_Penh'";
      const counts = await tx.query<{ sent: number; joined: number; month_joined: number }>(
        `SELECT (SELECT count(*)::int FROM public.invite_clicks WHERE inviter_id = $1) AS sent,
           (SELECT count(*)::int FROM public.invite_joins WHERE inviter_id = $1) AS joined,
           (SELECT count(*)::int FROM public.invite_joins WHERE inviter_id = $1 AND created_at >= ${monthStart}) AS month_joined`,
        [claims.sub],
      );
      const leaders = await tx.query(
        `SELECT j.inviter_id, j.count, p.full_name, p.avatar_url
         FROM (SELECT inviter_id, count(*)::int AS count FROM public.invite_joins WHERE created_at >= ${monthStart} GROUP BY inviter_id) j
         LEFT JOIN public.profiles p ON p.id = j.inviter_id
         ORDER BY j.count DESC LIMIT 10`,
      );
      return { code, ...counts.rows[0], leaders: leaders.rows };
    });
    return c.json(data);
  })

  // Claim the reward tiers the caller has earned, counted on the server. Runs with full rights, like the
  // web's service-role function: invite_rewards inserts and the badge flags are admin-only for clients.
  // Badges 5/25/50 are delivered at once (is_verified / is_recruiter / is_featured); the beer (100) stays pending.
  .post("/claim", async (c) => {
    const userId = c.get("claims")!.sub;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // One claim at a time per user, so two parallel calls can't insert the same tier twice.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('invite_claim:' || $1))", [userId]);
      const joined = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM public.invite_joins WHERE inviter_id = $1", [userId])).rows[0].n;
      const existing = new Set(
        (await client.query<{ tier: number }>("SELECT tier FROM public.invite_rewards WHERE user_id = $1", [userId])).rows.map((r) => r.tier),
      );
      const toInsert = TIERS.filter((t) => joined >= t && !existing.has(t));
      for (const tier of toInsert) {
        await client.query(
          "INSERT INTO public.invite_rewards (user_id, tier, status, sent_at) VALUES ($1, $2, $3, $4)",
          [userId, tier, tier === 100 ? "pending" : "sent", tier === 100 ? null : new Date()],
        );
      }
      if (toInsert.some((t) => t !== 100)) {
        await client.query(
          `UPDATE public.profiles SET is_verified = is_verified OR $2, is_recruiter = is_recruiter OR $3, is_featured = is_featured OR $4 WHERE id = $1`,
          [userId, toInsert.includes(5), toInsert.includes(25), toInsert.includes(50)],
        );
      }
      const rewards = await client.query("SELECT tier, status, sent_at FROM public.invite_rewards WHERE user_id = $1 ORDER BY tier", [userId]);
      await client.query("COMMIT");
      return c.json({ joined, newlyClaimed: toInsert, rewards: rewards.rows });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });

// Invite link landing (web: routes/join.tsx), no login needed: checks the code and counts the click,
// both through the same SECURITY DEFINER functions the web called as anon.
export const joinRoutes = new Hono<AuthEnv>().post("/:code", async (c) => {
  const code = c.req.param("code").slice(0, 64);
  const valid = await asUser(null, async (_db, tx) => {
    const inviter = (await tx.query<{ id: string | null }>("SELECT public.resolve_invite_code($1) AS id", [code])).rows[0]?.id;
    if (!inviter) return false;
    await tx.query("SELECT public.record_invite_click($1)", [code]);
    return true;
  });
  return c.json({ valid });
});
