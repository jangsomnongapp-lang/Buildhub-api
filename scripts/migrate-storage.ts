// Moves the photos/videos out of Supabase Storage (they are NOT in the DB dump) into our media folder,
// and points the database at the copies. Meant for the switch-over, against the database the API will use.
//
//   npx tsx scripts/migrate-storage.ts                 dry run: what is referenced, sizes, what's missing (downloads nothing)
//   npx tsx scripts/migrate-storage.ts --download      download every referenced file (public buckets by URL;
//                                                       private ones need SUPABASE_SERVICE_KEY). Resumable: existing files are skipped
//   npx tsx scripts/migrate-storage.ts --rewrite --base https://api.example.com
//                                                       rewrite the DB URLs/paths to <base>/media/supabase/<bucket>/<path>,
//                                                       only for files that were downloaded (one transaction)
//
// Files land in storage/media/supabase/<bucket>/<path>, served by the API at /media/supabase/... like our own uploads.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { pool } from "../src/db/client";
import { MEDIA_ROOT } from "../src/routes/uploads";

const SUPABASE = "https://onnnmkybphlmjwlwqbqv.supabase.co";
const PUBLIC_PREFIX = `${SUPABASE}/storage/v1/object/public/`;
const PUBLIC_BUCKETS = new Set(["rental-photos", "supplier-stores"]);

/** Columns holding full public URLs (found by scanning every text column, 2026-10-14). Chat text holds them inside JSON. */
const URL_COLUMNS: [table: string, column: string][] = [
  ["post_photos", "photo_url"],
  ["posts", "video_url"],
  ["profiles", "avatar_url"],
  ["stories", "media_url"],
  ["portfolio_photos", "photo_url"],
  ["rental_photos", "photo_url"],
  ["listing_photos", "photo_url"],
  ["supplier_catalog_items", "photo_url"],
  ["supplier_stores", "logo_url"],
  ["supplier_store_photos", "photo_url"],
  ["messages", "content"],
  ["message_threads", "last_message"],
];

/** Columns holding bare paths inside a private bucket (the web made signed URLs from them). */
const PATH_COLUMNS: [table: string, column: string, bucket: string][] = [
  ["project_logs", "photo_url", "project-photos"],
  ["material_request_photos", "photo_url", "material-photos"],
];

const args = process.argv.slice(2);
const mode = args.includes("--download") ? "download" : args.includes("--rewrite") ? "rewrite" : "dry";
const base = args[args.indexOf("--base") + 1];

interface FileRef {
  bucket: string;
  path: string;
}
const key = (f: FileRef) => `${f.bucket}/${f.path}`;
const localFile = (f: FileRef) => join(MEDIA_ROOT, "media", "supabase", f.bucket, ...f.path.split("/"));

/** Bucket paths must stay inside storage/media/supabase/<bucket>. */
function safe(f: FileRef) {
  const n = normalize(f.path);
  return f.path.length > 0 && !n.startsWith("..") && !n.includes(`..${sep}`) && !/^[\\/]/.test(f.path);
}

async function collect(): Promise<Map<string, FileRef>> {
  const refs = new Map<string, FileRef>();
  const urlRe = /https:\/\/onnnmkybphlmjwlwqbqv\.supabase\.co\/storage\/v1\/object\/public\/([a-z0-9-]+)\/([^"'\s)?#\\]+)/g;
  for (const [table, column] of URL_COLUMNS) {
    const { rows } = await pool.query<{ v: string }>(`SELECT "${column}" AS v FROM public."${table}" WHERE "${column}" LIKE $1`, [`%${PUBLIC_PREFIX}%`]);
    for (const { v } of rows)
      for (const m of v.matchAll(urlRe)) {
        const f = { bucket: m[1], path: decodeURIComponent(m[2]) };
        if (safe(f)) refs.set(key(f), f);
      }
  }
  for (const [table, column, bucket] of PATH_COLUMNS) {
    const { rows } = await pool.query<{ v: string }>(
      `SELECT "${column}" AS v FROM public."${table}" WHERE "${column}" IS NOT NULL AND "${column}" NOT LIKE 'http%' AND "${column}" NOT LIKE 'data:%'`,
    );
    for (const { v } of rows) {
      const f = { bucket, path: v };
      if (safe(f)) refs.set(key(f), f);
    }
  }
  return refs;
}

async function sizes() {
  const { rows } = await pool.query<{ bucket_id: string; name: string; size: string | null }>(
    "SELECT bucket_id, name, metadata->>'size' AS size FROM storage.objects",
  );
  return new Map(rows.map((r) => [`${r.bucket_id}/${r.name}`, Number(r.size ?? 0)]));
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function dryRun() {
  const refs = await collect();
  const known = await sizes();
  const perBucket = new Map<string, { files: number; bytes: number; missing: number; downloaded: number }>();
  for (const f of refs.values()) {
    const b = perBucket.get(f.bucket) ?? { files: 0, bytes: 0, missing: 0, downloaded: 0 };
    b.files++;
    const size = known.get(key(f));
    if (size === undefined) b.missing++;
    else b.bytes += size;
    if (existsSync(localFile(f))) b.downloaded++;
    perBucket.set(f.bucket, b);
  }
  console.log("Referenced by the database (only these get downloaded):");
  for (const [bucket, b] of perBucket)
    console.log(
      `  ${bucket.padEnd(16)} ${String(b.files).padStart(4)} files  ${mb(b.bytes).padStart(9)}  ${PUBLIC_BUCKETS.has(bucket) ? "public " : "PRIVATE (needs SUPABASE_SERVICE_KEY)"}` +
        `  not in storage.objects: ${b.missing}  already downloaded: ${b.downloaded}`,
    );
  let unref = 0;
  let unrefBytes = 0;
  for (const [k, size] of known) if (!refs.has(k)) (unref++, (unrefBytes += size));
  console.log(`Objects in storage.objects that nothing references (skipped): ${unref} (${mb(unrefBytes)})`);
}

async function download() {
  const refs = [...(await collect()).values()];
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  let done = 0;
  let skipped = 0;
  const failed: string[] = [];
  const queue = refs.filter((f) => {
    if (existsSync(localFile(f))) return (skipped++, false);
    if (!PUBLIC_BUCKETS.has(f.bucket) && !serviceKey) return (failed.push(`${key(f)}: private bucket, SUPABASE_SERVICE_KEY not set`), false);
    return true;
  });
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const encoded = f.path.split("/").map(encodeURIComponent).join("/");
      const url = PUBLIC_BUCKETS.has(f.bucket) ? `${PUBLIC_PREFIX}${f.bucket}/${encoded}` : `${SUPABASE}/storage/v1/object/${f.bucket}/${encoded}`;
      try {
        const res = await fetch(url, serviceKey && !PUBLIC_BUCKETS.has(f.bucket) ? { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } } : {});
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        await mkdir(dirname(localFile(f)), { recursive: true });
        await writeFile(localFile(f), bytes);
        done++;
        if (done % 25 === 0) console.log(`  ${done} downloaded…`);
      } catch (err) {
        failed.push(`${key(f)}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`downloaded ${done}, already there ${skipped}, failed ${failed.length}`);
  for (const f of failed.slice(0, 50)) console.log("  ✗", f);
}

async function rewrite() {
  if (!base || !/^https?:\/\//.test(base)) throw new Error("--rewrite needs --base <public API URL>, e.g. --base https://api.buildhubkh.com");
  const target = `${base.replace(/\/$/, "")}/media/supabase/`;
  const refs = [...(await collect()).values()];
  const ready = refs.filter((f) => existsSync(localFile(f)));
  console.log(`${ready.length} of ${refs.length} referenced files are downloaded; only those are rewritten.`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Chat messages are write-once (messages_immutable trigger). Switched off for this transaction only and
    // switched back on before COMMIT; on any error the ROLLBACK restores it too. Needs the table owner's role.
    await client.query("ALTER TABLE public.messages DISABLE TRIGGER messages_immutable");
    let changed = 0;
    for (const f of ready) {
      const encoded = f.path.split("/").map(encodeURIComponent).join("/");
      const from = [`${PUBLIC_PREFIX}${f.bucket}/${f.path}`, `${PUBLIC_PREFIX}${f.bucket}/${encoded}`];
      const to = `${target}${f.bucket}/${encoded}`;
      for (const [table, column] of URL_COLUMNS)
        for (const old of new Set(from))
          changed += (await client.query(`UPDATE public."${table}" SET "${column}" = replace("${column}", $1, $2) WHERE strpos("${column}", $1) > 0`, [old, to])).rowCount ?? 0;
      for (const [table, column, bucket] of PATH_COLUMNS)
        if (bucket === f.bucket) changed += (await client.query(`UPDATE public."${table}" SET "${column}" = $2 WHERE "${column}" = $1`, [f.path, to])).rowCount ?? 0;
    }
    await client.query("ALTER TABLE public.messages ENABLE TRIGGER messages_immutable");
    await client.query("COMMIT");
    console.log(`rewrote ${changed} values`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

try {
  if (mode === "dry") await dryRun();
  else if (mode === "download") await download();
  else await rewrite();
} finally {
  await pool.end();
}
