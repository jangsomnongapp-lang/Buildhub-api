// End-to-end check of the auth endpoints against the local API, using a throwaway account.
const API = "http://localhost:8787";
const post = async (path, body, token) => {
  const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const get = async (path, token) => {
  const r = await fetch(API + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, body: await r.json() };
};
const phone = "099000111"; // test number
const cats = await (async () => {
  const pg = (await import("pg")).default; await import("dotenv/config");
  const c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  await c.query("DELETE FROM auth.users WHERE email = 'p99000111@project001.local'");
  const ids = (await c.query("SELECT id FROM public.categories LIMIT 2")).rows.map((r) => r.id);
  await c.end(); return ids;
})();

const reg = await post("/auth/register", { fullName: "Test Worker", phone, password: "abc", language: "km", roles: { is_provider: true }, categoryIds: cats });
console.log("register:", reg.status, reg.body.user ?? reg.body);
console.log("register again:", (await post("/auth/register", { fullName: "X", phone: "+855 99 000 111", password: "abc" })).status, "(expect 409)");
console.log("login wrong pw:", (await post("/auth/login", { phone, password: "nope" })).status, "(expect 401)");
const login = await post("/auth/login", { phone: "+85599000111", password: "abc" });
console.log("login with +855 format:", login.status);
const me = await get("/auth/me", login.body.accessToken);
console.log("me:", me.status, { full_name: me.body.profile?.full_name, is_provider: me.body.profile?.is_provider, language: me.body.profile?.language, phone: me.body.profile?.phone });
console.log("me without token:", (await get("/auth/me")).status, "(expect 401)");
const ref = await post("/auth/refresh", { refreshToken: login.body.refreshToken });
console.log("refresh:", ref.status, "new token differs:", ref.body.refreshToken !== login.body.refreshToken);
console.log("reuse old refresh:", (await post("/auth/refresh", { refreshToken: login.body.refreshToken })).status, "(expect 401)");
console.log("logout:", (await post("/auth/logout", { refreshToken: ref.body.refreshToken })).status);
console.log("refresh after logout:", (await post("/auth/refresh", { refreshToken: ref.body.refreshToken })).status, "(expect 401)");

const pg = (await import("pg")).default;
const c = new pg.Client(process.env.DATABASE_URL); await c.connect();
console.log("categories saved:", (await c.query("SELECT count(*) FROM public.user_categories WHERE user_id = $1", [reg.body.user.id])).rows[0].count);
await c.query("DELETE FROM auth.users WHERE id = $1", [reg.body.user.id]);
console.log("test user removed, profile gone:", (await c.query("SELECT count(*) FROM public.profiles WHERE id = $1", [reg.body.user.id])).rows[0].count === "0");
await c.end();
