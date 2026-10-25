// Smoke test for every AI route, in-process (no server needed). Calls Gemini for real, spaced out for the
// free tier's per-minute limit. Usage (from buildhub-api):
//   npx tsx scripts/ai-smoke.ts <photo.jpg> [storeId]       GEMINI_MODEL=... to try another model
// Signs in as the seeded Test Worker; storeId must be one of that user's stores.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { authRoutes } from "../src/routes/auth";
import { aiRoutes } from "../src/routes/ai";

const app = new Hono().route("/auth", authRoutes).route("/ai", aiRoutes);

const [photo, storeId = "e70f96da-d587-465a-8434-a89312cc6f4d"] = process.argv.slice(2);
if (!photo) throw new Error("Usage: npx tsx scripts/ai-smoke.ts <photo.jpg> [storeId]");
const img = "data:image/jpeg;base64," + readFileSync(photo).toString("base64");
const pause = Number(process.env.AI_SMOKE_PAUSE_MS ?? 13_000);

const login = await app.request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "099000222", password: "test1234" }) });
const { accessToken } = (await login.json()) as { accessToken: string };

let first = true;
async function call(path: string, body: unknown) {
  if (!first) await new Promise((r) => setTimeout(r, pause));
  first = false;
  const t = Date.now();
  const res = await app.request(path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body) });
  console.log(`\n== ${path} ${res.status} ${Date.now() - t}ms\n${(await res.text()).slice(0, 600)}`);
}

await call("/ai/autofill", { flow: "material", text: "Need 50 bags of Kampot cement delivered to Toul Kork, budget about 300 dollars" });
await call("/ai/autofill", { flow: "rental", text: "Renting out a 20 ton excavator with operator, 150 USD per day, in Siem Reap" });
await call("/ai/autofill", { flow: "supplier", text: "We sell steel bars, cement and roofing sheets in Battambang" });
await call("/ai/autofill", { flow: "material", imageDataUrl: img });
await call("/ai/recognize-picture", { imageDataUrl: img });
await call(`/ai/stores/${storeId}/catalog/recognize`, { imageDataUrl: img });
await call(`/ai/stores/${storeId}/catalog/import`, { text: "Cement Kampot 50kg - 6.5$/bag\nSteel bar 12mm x 12m : 9.80 USD\nRoof sheet zinc 0.35mm 28,000 riel/sheet" });
await call("/ai/search", { query: "I need cement and a mason in Phnom Penh" });
process.exit(0);
