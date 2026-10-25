// Gives the two local test accounts a few alerts of each kind, so the Alerts page can be tried.
// Usage: npx tsx scripts/seed-test-notifications.ts   (local database only; run seed-test-user.mjs first)
import { pool } from "../src/db/client";

// Phone logins are stored as synthetic emails (see src/auth/phone.ts).
const { rows: users } = await pool.query<{ id: string; email: string }>("SELECT id, email FROM auth.users WHERE email = ANY($1)", [
  ["p99000222@project001.local", "p99000333@project001.local"],
]);
const worker = users.find((u) => u.email.startsWith("p99000222"))?.id;
const client = users.find((u) => u.email.startsWith("p99000333"))?.id;
if (!worker || !client) throw new Error("Test users not found; run scripts/seed-test-user.mjs first");

const one = async (sql: string) => (await pool.query<{ id: string }>(sql)).rows[0]?.id ?? null;
const post = await one("SELECT id FROM public.posts ORDER BY created_at DESC LIMIT 1");
const listing = await one("SELECT id FROM public.listings WHERE status = 'active' ORDER BY created_at DESC LIMIT 1");
const project = await one("SELECT id FROM public.projects ORDER BY created_at DESC LIMIT 1");

await pool.query("DELETE FROM public.notifications WHERE user_id = ANY($1)", [[worker, client]]);
const rows: [string, string, string, string | null, string | null, string | null, string | null, string][] = [
  // user, kind, title, related user, post, listing, project, age
  [client, "message", "New message", worker, null, null, null, "2 minutes"],
  [client, "like", "Like", worker, post, null, null, "40 minutes"],
  [client, "comment", "Comment", worker, post, null, null, "3 hours"],
  [client, "application", "Application", worker, null, listing, null, "1 day"],
  [client, "project_completed", "Project", worker, null, null, project, "2 days"],
  [client, "lottery_win", "Win", null, null, null, null, "3 days"],
  [client, "some_unknown_kind", "Stored title from the DB", null, null, null, null, "4 days"],
  [worker, "accepted", "Accepted", client, null, listing, null, "5 minutes"],
  [worker, "material_available", "Supplier", client, null, null, null, "1 hour"],
];
for (const [user, kind, title, rel, p, l, pr, age] of rows) {
  await pool.query(
    `INSERT INTO public.notifications (user_id, kind, title, related_user_id, related_post_id, related_listing_id, related_project_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() - $8::interval)`,
    [user, kind, title, rel, p, l, pr, age],
  );
}
// The older half is already read, so both "New" and "Earlier" sections show.
await pool.query("UPDATE public.notifications SET read_at = now() WHERE user_id = ANY($1) AND created_at < now() - interval '1 day 1 minute'", [
  [worker, client],
]);
console.log(`Seeded ${rows.length} alerts (post ${post}, listing ${listing}, project ${project})`);
await pool.end();
