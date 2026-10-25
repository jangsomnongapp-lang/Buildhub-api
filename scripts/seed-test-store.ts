// Gives the local Test Worker (099000222) an approved store with a few catalogue items, some events and an
// offer, so the owner-only store / catalogue pages can be tried. Note: store owners' /profile goes to the shop page.
// Usage: npx tsx scripts/seed-test-store.ts            (local database only; run seed-test-user.mjs first)
//        npx tsx scripts/seed-test-store.ts --remove   (deletes the test store again)
import { pool } from "../src/db/client";

const { rows } = await pool.query<{ id: string }>("SELECT id FROM auth.users WHERE email = 'p99000222@project001.local'");
const worker = rows[0]?.id;
if (!worker) throw new Error("Test worker not found; run scripts/seed-test-user.mjs first");

await pool.query("DELETE FROM public.supplier_stores WHERE user_id = $1 AND name = 'Test Worker Supply'", [worker]);
if (process.argv.includes("--remove")) {
  console.log("Test store removed");
  await pool.end();
  process.exit(0);
}

const store = (
  await pool.query<{ id: string }>(
    `INSERT INTO public.supplier_stores (user_id, name, location, description, status, view_count, phone)
     VALUES ($1, 'Test Worker Supply', 'Phnom Penh', 'Local test store', 'approved', 42, '099000222') RETURNING id`,
    [worker],
  )
).rows[0].id;

// Four catalogue items from the common product list: below / inside / above the market range, and one with no range.
const { rows: products } = await pool.query<{ id: string; name_en: string; name_km: string | null; category_id: string; market_price_min: number }>(
  `(SELECT id, name_en, name_km, category_id, market_price_min::float FROM public.catalog_products WHERE market_price_min IS NOT NULL ORDER BY name_en LIMIT 3)
   UNION ALL
   (SELECT id, name_en, name_km, category_id, NULL FROM public.catalog_products WHERE market_price_min IS NULL ORDER BY name_en LIMIT 1)`,
);
const prices = [4.5, 7, 12, 20];
const stock = ["in_stock", "low", "out", "in_stock"];
const items: string[] = [];
for (const [i, p] of products.entries()) {
  const { rows: r } = await pool.query<{ id: string }>(
    `INSERT INTO public.supplier_catalog_items (store_id, product_id, category_id, name_en, name_km, unit, price, currency, stock_status, in_stock, offer_active, offer_price, source)
     VALUES ($1, $2, $3, $4, $5, 'bag', $6, 'USD', $7, $7 <> 'out', $8, $9, 'list') RETURNING id`,
    [store, p.id, p.category_id, p.name_en, p.name_km, prices[i], stock[i], i === 1, i === 1 ? 6.5 : null],
  );
  items.push(r[0].id);
}

// A few views / chats this week so the panel numbers aren't all zero.
for (const [i, item] of items.entries()) {
  for (let n = 0; n <= i; n++) {
    await pool.query("INSERT INTO public.catalog_item_events (item_id, store_id, user_id, event_type) VALUES ($1, $2, NULL, 'view')", [item, store]);
  }
  if (i === 2) await pool.query("INSERT INTO public.catalog_item_events (item_id, store_id, user_id, event_type) VALUES ($1, $2, NULL, 'chat')", [item, store]);
}

console.log(`Test store ${store} with ${items.length} items`);
await pool.end();
