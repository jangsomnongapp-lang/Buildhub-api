import { pool } from "../db/client";

/** A job that replaces one pg_cron entry. Times are UTC, like pg_cron on Supabase. */
export interface Job {
  name: string;
  /** Called once per minute with the current UTC time; true = run now. */
  due: (now: Date) => boolean;
  run: () => Promise<unknown>;
}

export const everyMinute = () => true;
export const hourly = (now: Date) => now.getUTCMinutes() === 0;
export const dailyAt = (hour: number) => (now: Date) => now.getUTCHours() === hour && now.getUTCMinutes() === 0;

/** Stable 32-bit key per job name for pg_try_advisory_lock. */
function lockKey(name: string) {
  let h = 0;
  for (const ch of `buildhub-job:${name}`) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return h;
}

/**
 * Runs a job once. A Postgres advisory lock makes sure only one API instance runs it at a time,
 * and a slow run (e.g. a big push batch) is skipped by the next tick instead of overlapping.
 */
export async function runJob(job: Job) {
  const client = await pool.connect();
  const key = lockKey(job.name);
  try {
    const { rows } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    if (!rows[0].ok) return { skipped: "already_running" };
    try {
      return await job.run();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

/** Ticks at the start of every minute and runs the jobs that are due. Returns a stop function. */
export function startScheduler(jobs: Job[]) {
  let timer: NodeJS.Timeout;
  const tick = () => {
    const now = new Date();
    for (const job of jobs) {
      if (!job.due(now)) continue;
      runJob(job)
        .then((result) => {
          if (result !== undefined && !isQuiet(result)) console.log(`[job] ${job.name}`, JSON.stringify(result));
        })
        .catch((err) => console.error(`[job] ${job.name} failed`, err));
    }
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  };
  timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  return () => clearTimeout(timer);
}

/** Every-minute workers log only when they did something. */
function isQuiet(result: unknown) {
  return typeof result === "object" && result !== null && (result as { processed?: number }).processed === 0;
}
