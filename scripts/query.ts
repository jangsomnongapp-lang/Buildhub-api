// Runs one SQL statement on the LOCAL database as the owner role and prints the rows (debugging only).
// Usage: npx tsx scripts/query.ts "SELECT ..."
import { pool } from "../src/db/client";
const sql = process.argv[2];
const { rows } = await pool.query(sql);
console.log(JSON.stringify(rows, null, 1));
await pool.end();
