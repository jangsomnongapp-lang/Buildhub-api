// My rewards (web: routes/rewards.tsx) and draw results (web: routes/reward-results.tsx).
import { Hono } from "hono";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

export const rewardRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Streak, my active tickets, the next 5 scheduled draws, my prize claims and the "BuildHub Rewards"
  // account id (the chat button opens a thread with it through POST /messages/threads).
  .get("/", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const streak = await tx.query(
        "SELECT current_streak, longest_streak, last_check_date::text AS last_check_date FROM public.streak_tracker WHERE user_id = $1",
        [claims.sub],
      );
      const tickets = await tx.query(
        `SELECT id, ticket_type, ticket_number, draw_period_start::text AS draw_period_start, status, created_at
         FROM public.lottery_tickets WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC`,
        [claims.sub],
      );
      const upcoming = await tx.query(
        `SELECT id, draw_type, draw_date::text AS draw_date, prize_title, prize_image_url, winner_user_id, status
         FROM public.lottery_draws WHERE status = 'scheduled' ORDER BY draw_date LIMIT 5`,
      );
      const prizeClaims = await tx.query(
        "SELECT id, draw_id, status, expires_at FROM public.prize_claims WHERE winner_id = $1 ORDER BY created_at DESC",
        [claims.sub],
      );
      const rewardsUserId = (await tx.query<{ id: string | null }>("SELECT public.get_rewards_user_id() AS id")).rows[0]?.id ?? null;
      return {
        streak: streak.rows[0] ?? { current_streak: 0, longest_streak: 0, last_check_date: null },
        tickets: tickets.rows,
        upcoming: upcoming.rows,
        claims: prizeClaims.rows,
        rewardsUserId,
      };
    });
    return c.json(data);
  })

  // Winners of the last 7 days (`get_recent_draw_results_with_winner`) and my tickets, so my losing number
  // can be shown crossed out next to each winner.
  .get("/results", async (c) => {
    const claims = c.get("claims")!;
    const data = await asUser(claims, async (_db, tx) => {
      const results = await tx.query(
        `SELECT draw_id, draw_type, draw_date::text AS draw_date, prize_title, winner_name, winner_user_id, ticket_number, drawn_at
         FROM public.get_recent_draw_results_with_winner()`,
      );
      const mine = await tx.query(
        "SELECT ticket_type, ticket_number, draw_period_start::text AS draw_period_start FROM public.lottery_tickets WHERE user_id = $1",
        [claims.sub],
      );
      return { results: results.rows, myTickets: mine.rows };
    });
    return c.json(data);
  });
