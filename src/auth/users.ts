// Creating auth.users rows the way Supabase did (register, super-user identities).
import type pg from "pg";
import type { AuthUser } from "./tokens";

/**
 * Inserts the auth user + its email identity inside the caller's transaction. `meta` is stored as
 * raw_user_meta_data; the on_auth_user_created trigger builds the profile from it.
 */
export async function insertAuthUser(client: pg.PoolClient, email: string, passwordHash: string, meta: Record<string, unknown>): Promise<AuthUser> {
  const { rows } = await client.query<AuthUser>(
    `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at)
     VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, $2, now(),
       '{"provider":"email","providers":["email"]}', $3, now(), now(), now())
     RETURNING id, email, phone`,
    [email, passwordHash, meta],
  );
  const user = rows[0];
  await client.query(`UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('sub', id::text) WHERE id = $1`, [user.id]);
  await client.query(
    `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     VALUES ($1::text, $2::uuid, $3, 'email', now(), now(), now())`,
    [user.id, user.id, { ...meta, sub: user.id }],
  );
  return user;
}
