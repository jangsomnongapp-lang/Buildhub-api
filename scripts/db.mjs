// Runs a portable PostgreSQL 18 from node_modules, so no system install is needed.
// Usage: node scripts/db.mjs init | start | stop | status
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const BIN = resolve("node_modules/@embedded-postgres/windows-x64/native/bin");
const DATA = resolve(".pgdata");
const PORT = process.env.PGPORT ?? "5432";
const run = (exe, args) => execFileSync(join(BIN, exe), args, { stdio: "inherit" });

const cmd = process.argv[2];
if (cmd === "init") {
  if (existsSync(DATA)) {
    console.log(`Already initialised: ${DATA}`);
    process.exit(0);
  }
  if (!process.env.PGPASSWORD) throw new Error("PGPASSWORD missing from .env");
  mkdirSync("logs", { recursive: true });
  const pwfile = resolve("logs/.pwfile");
  writeFileSync(pwfile, process.env.PGPASSWORD);
  try {
    run("initdb.exe", [
      "-D", DATA,
      "-U", "postgres",
      "-A", "scram-sha-256",
      `--pwfile=${pwfile}`,
      "-E", "UTF8",
      "--locale-provider=builtin",
      "--builtin-locale=C.UTF-8",
      "--locale=C",
    ]);
  } finally {
    rmSync(pwfile, { force: true });
  }
} else if (cmd === "start") {
  mkdirSync("logs", { recursive: true });
  // stdio "ignore": the server inherits our pipes otherwise, and this command never returns.
  execFileSync(join(BIN, "pg_ctl.exe"), ["start", "-D", DATA, "-l", resolve("logs/postgres.log"), "-o", `-p ${PORT}`, "-w"], { stdio: "ignore" });
  run("pg_ctl.exe", ["status", "-D", DATA]);
} else if (cmd === "stop") {
  run("pg_ctl.exe", ["stop", "-D", DATA, "-m", "fast"]);
} else if (cmd === "status") {
  run("pg_ctl.exe", ["status", "-D", DATA]);
} else {
  console.log("Usage: node scripts/db.mjs init | start | stop | status");
}
