import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as tables from "./schema";
import * as relations from "./relations";
import { env } from "../env";

const schema = { ...tables, ...relations };
export type Db = NodePgDatabase<typeof schema>;

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

/** Full-access handle that bypasses RLS. Only for auth and background jobs, never for user requests. */
export const adminDb: Db = drizzle(pool, { schema });

/** JWT claims, in the same shape Supabase puts in `request.jwt.claims` (read by auth.uid()). */
export interface Claims {
  sub: string;
  role: "authenticated";
  aud: "authenticated";
  email: string | null;
  phone: string | null;
}

/**
 * Runs `fn` in a transaction as the given user (or as `anon` when claims is null).
 * The 205 RLS policies restored from Supabase then apply exactly as before.
 */
export async function asUser<T>(claims: Claims | null, fn: (db: Db, client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('role', $1, true), set_config('request.jwt.claims', $2, true)", [
      claims ? "authenticated" : "anon",
      JSON.stringify(claims ?? { role: "anon" }),
    ]);
    const result = await fn(drizzle(client, { schema }), client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
