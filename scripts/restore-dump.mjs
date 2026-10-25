// Rebuilds the local `buildhub` database from the Supabase dump (without pg_restore).
// Usage: node scripts/restore-dump.mjs [dump-path] [--yes-drop-remote]
// WARNING: drops and recreates the database named in DATABASE_URL every run (local: `buildhub`).
// For a hosted database (the switch-over, docs/DEPLOY_RAILWAY.md) it refuses unless --yes-drop-remote is given.
import "dotenv/config";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { readDump, readEntryData } from "./pgdump-reader.mjs";

const DUMP = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "../biz-link-droid_260921.backup/biz-link-droid_260921.backup";
const DRIZZLE_DIR = "../biz-link-droid/drizzle/migrations";
const url0 = new URL(process.env.DATABASE_URL);
const DB = decodeURIComponent(url0.pathname.slice(1)) || "buildhub";
if (!["localhost", "127.0.0.1", "::1"].includes(url0.hostname) && !process.argv.includes("--yes-drop-remote")) {
  console.error(`Refusing to drop and rebuild "${DB}" on ${url0.hostname}. Add --yes-drop-remote if that is really what you want.`);
  process.exit(1);
}

// Schemas we keep. Everything else (realtime, cron, pgmq, vault, graphql, ...) is Supabase-internal.
const KEEP_SCHEMAS = new Set(["public", "auth", "storage"]);
const SKIP_DESCS = new Set([
  "PUBLICATION", "PUBLICATION TABLE", "EVENT TRIGGER", "EXTENSION",
  "DATABASE", "DATABASE PROPERTIES", "ENCODING", "STDSTRINGS", "SEARCHPATH",
]);
// Grants are kept: the API runs queries as `anon`/`authenticated`, so the RLS policies still apply.
const ACL_DESCS = new Set(["ACL", "DEFAULT ACL"]);

const url = url0;
const errors = [];

async function connect(database) {
  const c = new pg.Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    // Hosted Postgres (Railway) needs TLS; the local one doesn't.
    ssl: url.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  return c;
}

async function exec(client, label, sql) {
  try {
    await client.query(sql);
    return true;
  } catch (err) {
    errors.push({ label, error: err.message, sql: sql.slice(0, 500) });
    return false;
  }
}

function copyData(client, copyStmt, data) {
  // Strip the "\." end marker; the COPY protocol ends the stream itself.
  let text = data.toString("utf8");
  if (text.endsWith("\\.\n")) text = text.slice(0, -3);
  return new Promise((resolve, reject) => {
    const stream = client.query(copyFrom(copyStmt.trim().replace(/;$/, "")));
    stream.on("finish", resolve);
    stream.on("error", reject);
    stream.end(text);
  });
}

function keep(e) {
  if (SKIP_DESCS.has(e.desc)) return false;
  if (e.desc === "SCHEMA") return KEEP_SCHEMAS.has(e.tag) && e.tag !== "public";
  if (!e.namespace) {
    if (e.desc === "COMMENT") return /ON SCHEMA (auth|storage)\b/.test(e.defn ?? "");
    if (ACL_DESCS.has(e.desc)) return /ON SCHEMA (public|auth|storage|extensions)\b/.test(e.defn ?? "");
    return false;
  }
  return KEEP_SCHEMAS.has(e.namespace);
}

// Every role named in a kept grant must exist, or the GRANT fails.
function referencedRoles(entries) {
  const roles = new Set(["anon", "authenticated", "service_role", "authenticator"]);
  for (const e of entries) {
    if (!ACL_DESCS.has(e.desc) || !keep(e)) continue;
    for (const m of e.defn.matchAll(/\b(?:TO|FROM|ROLE) ([a-z_][a-z0-9_]*(?:,\s*[a-z_][a-z0-9_]*)*)/g)) {
      for (const r of m[1].split(/,\s*/)) if (!["public", "postgres", "pg_monitor"].includes(r)) roles.add(r);
    }
  }
  return [...roles];
}

async function main() {
  console.log(`Reading ${DUMP}`);
  const dump = readDump(DUMP);
  console.log(dump.header);

  const admin = await connect("postgres");
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB} TEMPLATE template0 ENCODING 'UTF8'`);
  for (const role of referencedRoles(dump.entries)) {
    await admin.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  }
  await admin.end();

  const db = await connect(DB);
  await db.query(`
    SET check_function_bodies = false;
    SET client_min_messages = warning;
    SET standard_conforming_strings = on;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
  `);

  const stats = { ddl: 0, ddlFailed: 0, tables: 0, rows: 0, skipped: 0 };
  for (const e of dump.entries) {
    if (!keep(e)) {
      stats.skipped++;
      continue;
    }
    // Each entry runs with an empty search_path, like pg_restore does (definitions are schema-qualified).
    await db.query("SELECT pg_catalog.set_config('search_path', '', false)");
    if (e.desc === "TABLE DATA") {
      const data = readEntryData(dump, e);
      if (!data || data.length <= 3) continue;
      try {
        await copyData(db, e.copyStmt, data);
        stats.tables++;
        stats.rows += data.toString("utf8").split("\n").length - 2;
      } catch (err) {
        errors.push({ label: `DATA ${e.namespace}.${e.tag}`, error: err.message });
      }
      continue;
    }
    if (!e.defn?.trim()) continue;
    const ok = await exec(db, `${e.desc} ${e.namespace ?? ""}.${e.tag}`, e.defn);
    ok ? stats.ddl++ : stats.ddlFailed++;
  }
  console.log("Dump restored:", stats);

  // Our own SQL (Supabase stand-ins, later changes), in file order.
  for (const file of readdirSync("sql").filter((f) => f.endsWith(".sql")).sort()) {
    const ok = await exec(db, `SQL ${file}`, readFileSync(join("sql", file), "utf8"));
    console.log(`${ok ? "applied " : "FAILED  "} sql/${file}`);
  }

  // Changes made after the dump was taken (marketplace_items, store_followers, ...).
  await db.query("SET search_path = public, extensions");
  for (const file of readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(DRIZZLE_DIR, file), "utf8").replaceAll("--> statement-breakpoint", "");
    const ok = await exec(db, `DRIZZLE ${file}`, sql);
    console.log(`${ok ? "applied " : "FAILED  "} ${file}`);
  }
  await db.end();

  mkdirSync("logs", { recursive: true });
  writeFileSync("logs/restore-errors.json", JSON.stringify(errors, null, 2));
  console.log(`${errors.length} errors → logs/restore-errors.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
