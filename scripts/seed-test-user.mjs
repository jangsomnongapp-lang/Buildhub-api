// Creates local test accounts for trying the app (local database only).
// Usage: node scripts/seed-test-user.mjs   (API must be running)
// "Test Admin" gets is_admin and is_super_user, for trying the admin screens and the super-user panel
// without a real admin account.
import "dotenv/config";
import pg from "pg";

export const TEST_USERS = [
  { fullName: "Test Worker", phone: "099000222", password: "test1234", language: "km", roles: { is_provider: true } },
  { fullName: "Test Client", phone: "099000333", password: "test1234", language: "en", roles: { is_client: true } },
  { fullName: "Test Admin", phone: "099000444", password: "test1234", language: "en", roles: { is_client: true }, admin: true },
];

const API = process.env.API_URL ?? "http://localhost:8787";
for (const { admin, ...user } of TEST_USERS) {
  const res = await fetch(`${API}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(user) });
  const body = await res.json();
  if (res.status === 409) console.log(`${user.fullName}: already exists`);
  else if (res.ok) console.log(`${user.fullName}: created ${body.user.id}`);
  else console.log(`${user.fullName}: failed`, res.status, body);
}

// As the DB owner, so the privilege guard trigger lets the flag through.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
for (const user of TEST_USERS.filter((u) => u.admin)) {
  const r = await db.query("UPDATE public.profiles SET is_admin = true, is_super_user = true WHERE full_name = $1 AND phone = $2", [user.fullName, `+855${user.phone.replace(/^0/, "")}`]);
  console.log(`${user.fullName}: is_admin + is_super_user set on ${r.rowCount} profile(s)`);
}
await db.end();
