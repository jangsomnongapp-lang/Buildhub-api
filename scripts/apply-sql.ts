// Applies one sql/*.sql file to the local database (as the owner), e.g. after adding a new one:
//   npx tsx scripts/apply-sql.ts sql/003_realtime.sql
import { readFileSync } from "node:fs";
import { pool } from "../src/db/client";

try {
  await pool.query(readFileSync(process.argv[2], "utf8"));
  console.log(`applied ${process.argv[2]}`);
} catch (e) {
  console.error("FAILED", (e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
