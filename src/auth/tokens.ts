import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";
import { pool, type Claims } from "../db/client";

const secret = new TextEncoder().encode(env.JWT_SECRET);
export const ACCESS_TOKEN_TTL = 60 * 60; // 1 hour
const REFRESH_TOKEN_DAYS = 60;

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
}

export async function signAccessToken(user: AuthUser) {
  return new SignJWT({ role: "authenticated", email: user.email, phone: user.phone })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<Claims> {
  const { payload } = await jwtVerify(token, secret, { audience: "authenticated" });
  if (!payload.sub) throw new Error("Token has no subject");
  return {
    sub: payload.sub,
    role: "authenticated",
    aud: "authenticated",
    email: (payload.email as string | null) ?? null,
    phone: (payload.phone as string | null) ?? null,
  };
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function issueRefreshToken(userId: string, userAgent?: string) {
  const token = randomBytes(32).toString("base64url");
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO api.refresh_tokens (user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING id`,
    [userId, hash(token), userAgent ?? null, REFRESH_TOKEN_DAYS],
  );
  return { token, id: rows[0].id };
}

/** Swaps a valid refresh token for a new one (rotation). Returns the user id, or null if invalid. */
export async function rotateRefreshToken(token: string, userAgent?: string) {
  const { rows } = await pool.query<{ id: string; user_id: string }>(
    `UPDATE api.refresh_tokens SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
     RETURNING id, user_id`,
    [hash(token)],
  );
  if (!rows[0]) return null;
  const next = await issueRefreshToken(rows[0].user_id, userAgent);
  await pool.query("UPDATE api.refresh_tokens SET replaced_by = $1 WHERE id = $2", [next.id, rows[0].id]);
  return { userId: rows[0].user_id, refreshToken: next.token };
}

export async function revokeRefreshToken(token: string) {
  await pool.query("UPDATE api.refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [hash(token)]);
}

/** Access + refresh token pair for a user (login, register, super-user identity switch). */
export async function issueSession(user: AuthUser, userAgent?: string) {
  const [accessToken, refresh] = await Promise.all([signAccessToken(user), issueRefreshToken(user.id, userAgent)]);
  return { accessToken, refreshToken: refresh.token, expiresIn: ACCESS_TOKEN_TTL, user };
}
