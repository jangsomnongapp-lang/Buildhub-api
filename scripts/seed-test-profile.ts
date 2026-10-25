// Fills the two local test accounts' profiles: a job, an accepted application, projects in each
// state, a review and portfolio photos, so every /profile and /users/:id section has data.
// Usage: npx tsx scripts/seed-test-profile.ts   (local database only; run seed-test-user.mjs first)
import { pool } from "../src/db/client";

const { rows: users } = await pool.query<{ id: string; email: string }>("SELECT id, email FROM auth.users WHERE email = ANY($1)", [
  ["p99000222@project001.local", "p99000333@project001.local"],
]);
const worker = users.find((u) => u.email.startsWith("p99000222"))?.id;
const client = users.find((u) => u.email.startsWith("p99000333"))?.id;
if (!worker || !client) throw new Error("Test users not found; run scripts/seed-test-user.mjs first");

// Start clean (cascades remove applications and ratings).
await pool.query("DELETE FROM public.projects WHERE owner_id = ANY($1) OR worker_id = ANY($1)", [[worker, client]]);
await pool.query("DELETE FROM public.listings WHERE user_id = ANY($1)", [[worker, client]]);
await pool.query("DELETE FROM public.portfolio_photos WHERE user_id = ANY($1)", [[worker, client]]);

const listing = (
  await pool.query<{ id: string }>(
    `INSERT INTO public.listings (user_id, title, description, location, status)
     VALUES ($1, 'Tile a 80 m² floor', 'Test job for the profile page', 'Phnom Penh', 'active') RETURNING id`,
    [client],
  )
).rows[0].id;
await pool.query("INSERT INTO public.applications (listing_id, applicant_id, status) VALUES ($1, $2, 'accepted')", [listing, worker]);

const project = async (status: string, requestedBy: string | null) =>
  (
    await pool.query<{ id: string }>(
      "INSERT INTO public.projects (owner_id, worker_id, status, completion_requested_by, setup_completed) VALUES ($1, $2, $3, $4, true) RETURNING id",
      [client, worker, status, requestedBy],
    )
  ).rows[0].id;
await project("active", worker); // client sees Confirm / Reject
await project("active", null); // "End project"
await project("pending", null); // client: "Cancel request"; worker: "New request"
await project("completed", null); // "Rate" (nobody rated yet)
const rated = await project("completed", null);
await pool.query("INSERT INTO public.project_ratings (project_id, rater_id, rated_id, stars, comment) VALUES ($1, $2, $3, 4, 'Clean, careful work')", [
  rated,
  client,
  worker,
]);

// Borrow a few existing photos for the worker's portfolio.
await pool.query(
  "INSERT INTO public.portfolio_photos (user_id, photo_url) SELECT $1, photo_url FROM public.portfolio_photos WHERE user_id <> $1 LIMIT 7",
  [worker],
);
console.log("Seeded test profiles: 1 job, 1 accepted application, 5 projects, 1 review, portfolio photos");
await pool.end();
