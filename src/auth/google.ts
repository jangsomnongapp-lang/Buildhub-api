// Google sign-in. Replaces Supabase's signInWithIdToken({ provider: "google" }): the app sends the
// Google ID token, we check it against Google's keys, then find or create the user the way Supabase did
// (auth.identities provider 'google', provider_id = Google's `sub`; an existing account with the same
// verified email gets the Google identity linked).
import { createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { pool } from "../db/client";
import type { AuthUser } from "./tokens";

/** The web client id the web app and its native wrapper used (public, from biz-link-droid/src/lib/nativeGoogleLogin.ts). */
const DEFAULT_CLIENT_ID = "997514086528-6g3c05853170ioct0ijo2b43oall9sem.apps.googleusercontent.com";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

/** Throws 401 for anything that isn't a fresh Google ID token for one of our client ids. */
export async function verifyGoogleIdToken(idToken: string, rawNonce?: string): Promise<GoogleProfile> {
  const audience = (process.env.GOOGLE_CLIENT_IDS ?? DEFAULT_CLIENT_ID).split(",").map((s) => s.trim()).filter(Boolean);
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, googleKeys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience }));
  } catch {
    throw new HTTPException(401, { message: "invalid_google_token" });
  }
  // Same nonce rule as Supabase: the token carries sha256(rawNonce) when the app asked for one.
  if (typeof payload.nonce === "string" || rawNonce) {
    const expected = rawNonce ? createHash("sha256").update(rawNonce).digest("hex") : null;
    if (payload.nonce !== expected) throw new HTTPException(401, { message: "invalid_google_token" });
  }
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    throw new HTTPException(401, { message: "invalid_google_token" });
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : "",
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

interface UserRow extends AuthUser {
  banned_until: Date | null;
}

/**
 * Returns the user for this Google account, creating it (profile via the on_auth_user_created trigger) if new.
 * `newUserMeta` (e.g. the role flags picked on Register) only goes into a new user's raw_user_meta_data,
 * where the trigger reads it, as for phone registration.
 */
export async function findOrCreateGoogleUser(g: GoogleProfile, newUserMeta: Record<string, unknown> = {}): Promise<{ user: AuthUser; created: boolean }> {
  // identity_data / raw_user_meta_data in the same shape Supabase stored for Google users.
  const identityData = {
    iss: "https://accounts.google.com",
    sub: g.sub,
    provider_id: g.sub,
    email: g.email,
    email_verified: g.emailVerified,
    phone_verified: false,
    name: g.name,
    full_name: g.name,
    ...(g.picture ? { picture: g.picture, avatar_url: g.picture } : {}),
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let created = false;
    let { rows } = await client.query<UserRow>(
      `SELECT u.id, u.email, u.phone, u.banned_until FROM auth.identities i JOIN auth.users u ON u.id = i.user_id
       WHERE i.provider = 'google' AND i.provider_id = $1 AND u.deleted_at IS NULL`,
      [g.sub],
    );
    if (rows[0]) {
      await client.query(
        "UPDATE auth.identities SET identity_data = $2, last_sign_in_at = now(), updated_at = now() WHERE provider = 'google' AND provider_id = $1",
        [g.sub, identityData],
      );
    } else {
      // Supabase links a new Google identity to an existing account only when Google says the email is verified.
      if (g.emailVerified) {
        ({ rows } = await client.query<UserRow>(
          "SELECT id, email, phone, banned_until FROM auth.users WHERE lower(email) = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
          [g.email],
        ));
      } else {
        // Unverified Google email that already belongs to an account: can't link and can't create (email is unique).
        const taken = await client.query("SELECT 1 FROM auth.users WHERE lower(email) = $1", [g.email]);
        if (taken.rowCount) throw new HTTPException(409, { message: "email_in_use" });
        rows = [];
      }
      if (rows[0]) {
        await client.query(
          `UPDATE auth.users SET raw_app_meta_data = jsonb_set(coalesce(raw_app_meta_data, '{}'), '{providers}',
             (SELECT jsonb_agg(DISTINCT p) FROM jsonb_array_elements_text(coalesce(raw_app_meta_data->'providers', '[]') || '["google"]') p))
           WHERE id = $1`,
          [rows[0].id],
        );
      } else {
        ({ rows } = await client.query<UserRow>(
          `INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at,
             raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
           VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, $2,
             '{"provider":"google","providers":["google"]}', $3, now(), now())
           RETURNING id, email, phone, banned_until`,
          [g.email, g.emailVerified ? new Date() : null, { ...identityData, ...newUserMeta }],
        ));
        created = true;
      }
      await client.query(
        // identities.email is generated from identity_data.
        `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'google', now(), now(), now())`,
        [g.sub, rows[0].id, identityData],
      );
    }
    const user = rows[0];
    if (user.banned_until && user.banned_until > new Date()) throw new HTTPException(403, { message: "banned" });
    await client.query("UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1", [user.id]);
    await client.query("COMMIT");
    return { user: { id: user.id, email: user.email, phone: user.phone }, created };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
