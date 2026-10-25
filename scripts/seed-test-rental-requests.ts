// Adds approved "Looking for rent" requests (Market → Rent → ស្វែងរកជួល) from the local test users, one or more
// per rent category, so the list has something to show.
// Usage: npx tsx scripts/seed-test-rental-requests.ts            (local database only; run seed-test-user.mjs first)
//        npx tsx scripts/seed-test-rental-requests.ts --remove   (deletes them again)
import { pool } from "../src/db/client";

// Every seeded row's description ends with this, so --remove only touches test data.
const MARK = " (test data)";

const { rows: users } = await pool.query<{ id: string; email: string }>(
  "SELECT id, email FROM auth.users WHERE email IN ('p99000222@project001.local', 'p99000333@project001.local')",
);
const byEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));
const worker = byEmail["p99000222@project001.local"];
const client = byEmail["p99000333@project001.local"];
if (!worker || !client) throw new Error("Test users not found; run scripts/seed-test-user.mjs first");

const removed = await pool.query("DELETE FROM public.rental_requests WHERE user_id = ANY($1) AND description LIKE $2", [
  [worker, client],
  `%${MARK}`,
]);
if (process.argv.includes("--remove")) {
  console.log(`Removed ${removed.rowCount} test rental request(s)`);
  await pool.end();
  process.exit(0);
}

// [user, title, description, category, location, budget per day, currency, needed in N days, created N hours ago]
const REQUESTS: [string, string, string, string, string, number | null, "USD" | "KHR", number | null, number][] = [
  [client, "ត្រូវការជួលអេស្កាវ៉ាទ័រ", "សម្រាប់ជីកគ្រឹះផ្ទះ ២ ជាន់ ប្រហែល ៣ ថ្ងៃ", "heavy", "ភ្នំពេញ", 180, "USD", 5, 2],
  [worker, "Looking for a 5-ton dump truck", "Need it to move soil from site, about one week, driver included preferred", "vehicles", "Siem Reap", 90, "USD", 3, 6],
  [client, "ជួលម៉ាស៊ីនលាយបេតុង", "ម៉ាស៊ីនលាយតូច សម្រាប់ចាក់កម្រាលផ្ទះ", "light", "កណ្ដាល", 120000, "KHR", 2, 20],
  [worker, "ត្រូវការជួលរន្ទាដែក", "រន្ទាសម្រាប់លាបថ្នាំអគារ ៣ ជាន់ ប្រហែល ២ សប្ដាហ៍", "tools", "ភ្នំពេញ", 25, "USD", 7, 30],
  [client, "Need a warehouse for building materials", "Around 200 m², close to the main road, one month", "space", "Battambang", null, "USD", 10, 50],
  [worker, "ជួលម៉ាស៊ីនកាត់ការ៉ូ", "ម៉ាស៊ីនកាត់ការ៉ូ និងម៉ាស៊ីនខួង សម្រាប់ ៥ ថ្ងៃ", "tools", "តាកែវ", 40000, "KHR", null, 72],
];

for (const [user, title, description, category, location, budget, currency, neededIn, hoursAgo] of REQUESTS) {
  await pool.query(
    `INSERT INTO public.rental_requests (user_id, title, description, category, location, budget_per_day, currency, needed_from, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8::int IS NULL THEN NULL ELSE current_date + $8::int END, 'approved', now() - make_interval(hours => $9))`,
    [user, title, description + MARK, category, location, budget, currency, neededIn, hoursAgo],
  );
}
console.log(`Added ${REQUESTS.length} approved test rental requests`);
await pool.end();
