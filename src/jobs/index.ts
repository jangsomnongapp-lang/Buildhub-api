// Background jobs that replace the pg_cron entries on Supabase (copied from the dump's cron.job table).
import { pool } from "../db/client";
import { env } from "../env";
import { processHttpQueue } from "./http-queue";
import { processPushQueue } from "./push";
import { dailyAt, everyMinute, hourly, startScheduler, type Job } from "./scheduler";

/** DB housekeeping: safe to run anywhere, it only changes rows in this database. */
export const maintenanceJobs: Job[] = [
  {
    // cron "rewards-expire-claims", 0 * * * *
    name: "expire-claims",
    due: hourly,
    run: () => pool.query("SELECT public.expire_overdue_claims() AS expired").then((r) => r.rows[0]),
  },
  {
    // cron "expire-stale-listings", 0 3 * * *
    name: "expire-stale-listings",
    due: dailyAt(3),
    run: () =>
      pool
        .query(
          `UPDATE public.listings SET status = 'expired', updated_at = now()
           WHERE status = 'active' AND created_at < now() - interval '60 days'`,
        )
        .then((r) => ({ expired: r.rowCount })),
  },
  {
    // cron "rewards-auto-run-draws", 0 5 * * *
    name: "auto-run-draws",
    due: dailyAt(5),
    run: () => pool.query("SELECT public.auto_run_due_draws() AS result").then((r) => r.rows[0]?.result ?? { ok: true }),
  },
];

/**
 * Jobs that reach real people (phones, the admin Telegram group). The local DB is a copy of
 * production with real device tokens, so these only run when SEND_NOTIFICATIONS=true.
 */
export const sendingJobs: Job[] = [
  // cron "push-queue-worker", * * * * * (on Supabase it called the web's /api/public/process-push-queue)
  { name: "push-queue", due: everyMinute, run: processPushQueue },
  // pg_net calls queued by triggers (admin Telegram alerts)
  { name: "http-queue", due: everyMinute, run: processHttpQueue },
];

export const allJobs = [...maintenanceJobs, ...sendingJobs];

export function startJobs() {
  if (!env.JOBS) {
    console.log("[job] background jobs are off (JOBS=false)");
    return;
  }
  const jobs = env.SEND_NOTIFICATIONS ? allJobs : maintenanceJobs;
  if (!env.SEND_NOTIFICATIONS) console.log("[job] push and Telegram sending are off (set SEND_NOTIFICATIONS=true to send)");
  startScheduler(jobs);
}
