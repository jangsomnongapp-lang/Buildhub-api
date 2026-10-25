// Moves pictures stored inside the database as base64 data: URLs (about 30 MB: profile photos, shop
// logos, portfolio and chat images, found by scanning every text column on 2026-10-22) into files,
// and stores their links instead. Run it at the switch-over, after migrate-storage.ts, with the same base.
//
//   npx tsx scripts/extract-inline-images.ts                      dry run: counts and sizes, changes nothing
//   npx tsx scripts/extract-inline-images.ts --write --base https://api.example.com
//                                                                  write the files to storage/media/inline/
//                                                                  and update the rows (one transaction)
//
// Row triggers are switched off inside the transaction: messages and threads are write-once, and the
// rows' updated_at should not move. Files are named by content hash, so running it twice is harmless.
import { pool } from "../src/db/client";
import { messageToFileUrls, toFileUrl } from "../src/media/inline";

/** Columns whose whole value can be a data:image URL. */
const VALUE_COLUMNS: [table: string, column: string][] = [
  ["profiles", "avatar_url"],
  ["supplier_stores", "logo_url"],
  ["supplier_store_photos", "photo_url"],
  ["portfolio_photos", "photo_url"],
  ["post_photos", "photo_url"],
];
/** Columns holding chat content, where an image attachment carries the data URL inside JSON. */
const MESSAGE_COLUMNS: [table: string, column: string][] = [
  ["messages", "content"],
  ["message_threads", "last_message"],
];

const args = process.argv.slice(2);
const write = args.includes("--write");
const base = write ? args[args.indexOf("--base") + 1] : "http://dry-run";
if (write && !/^https?:\/\/[^/]+/.test(base ?? "")) {
  console.error("--write needs --base <public API URL>, e.g. --base https://api.buildhubkh.com");
  process.exit(1);
}

interface Change {
  table: string;
  column: string;
  id: string;
  before: number;
  value: string;
}
const changes: Change[] = [];

for (const [table, column] of [...VALUE_COLUMNS, ...MESSAGE_COLUMNS]) {
  const { rows } = await pool.query<{ id: string; v: string }>(
    `SELECT id::text, "${column}" AS v FROM public."${table}" WHERE "${column}" LIKE '%data:image/%'`,
  );
  const isMessage = MESSAGE_COLUMNS.some(([t, c]) => t === table && c === column);
  let bytes = 0;
  let converted = 0;
  for (const r of rows) {
    bytes += r.v.length;
    const value = write
      ? isMessage
        ? await messageToFileUrls(r.v, base)
        : await toFileUrl(r.v, base)
      : r.v;
    if (write && value === r.v) continue;
    converted++;
    if (write) changes.push({ table, column, id: r.id, before: r.v.length, value });
  }
  console.log(`${table}.${column}: ${rows.length} rows, ${(bytes / 1e6).toFixed(1)} MB${write ? `, ${converted} converted` : ""}`);
}

if (!write) {
  console.log("\nDry run. Add --write --base <public API URL> to convert.");
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const tables = [...new Set(changes.map((c) => c.table))];
  for (const t of tables) await client.query(`ALTER TABLE public."${t}" DISABLE TRIGGER USER`);
  for (const ch of changes) {
    await client.query(`UPDATE public."${ch.table}" SET "${ch.column}" = $2 WHERE id::text = $1`, [ch.id, ch.value]);
  }
  for (const t of tables) await client.query(`ALTER TABLE public."${t}" ENABLE TRIGGER USER`);
  await client.query("COMMIT");
  const saved = changes.reduce((n, c) => n + c.before - c.value.length, 0);
  console.log(`\nUpdated ${changes.length} rows; the database is ${(saved / 1e6).toFixed(1)} MB lighter.`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
  await pool.end();
}
