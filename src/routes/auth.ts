import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool, asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";
import { normalizePassword, phoneLoginEmails, phoneToEmail, phoneE164 } from "../auth/phone";
import { insertAuthUser } from "../auth/users";
import { findOrCreateGoogleUser, verifyGoogleIdToken } from "../auth/google";
import {
  ACCESS_TOKEN_TTL,
  issueSession,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  type AuthUser,
} from "../auth/tokens";

interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  encrypted_password: string | null;
  email_confirmed_at: Date | null;
  banned_until: Date | null;
  deleted_at: Date | null;
}

const USER_COLUMNS = "id, email, phone, encrypted_password, email_confirmed_at, banned_until, deleted_at";

const session = issueSession;

const toAuthUser = (u: UserRow): AuthUser => ({ id: u.id, email: u.email, phone: u.phone });

const loginBody = z.union([
  z.object({ phone: z.string().min(3), password: z.string().min(1) }),
  z.object({ email: z.string().email(), password: z.string().min(1) }),
]);

const registerBody = z.object({
  fullName: z.string().trim().min(1),
  phone: z.string().min(3),
  password: z.string().min(1),
  language: z.enum(["km", "en"]).default("km"),
  roles: z
    .object({
      is_provider: z.boolean().default(false),
      is_coordinator: z.boolean().default(false),
      is_organization: z.boolean().default(false),
      is_client: z.boolean().default(false),
      is_specialist: z.boolean().default(false),
    })
    .default({ is_provider: false, is_coordinator: false, is_organization: false, is_client: false, is_specialist: false }),
  categoryIds: z.array(z.string().uuid()).default([]),
  inviteCode: z.string().optional(),
});

export const authRoutes = new Hono<AuthEnv>()
  .post("/login", zValidator("json", loginBody), async (c) => {
    const body = c.req.valid("json");
    const emails = "phone" in body ? phoneLoginEmails(body.phone) : [body.email.trim().toLowerCase()];
    const { rows } = await pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM auth.users WHERE lower(email) = ANY($1) AND deleted_at IS NULL`,
      [emails],
    );
    const password = normalizePassword(body.password);
    let user: UserRow | undefined;
    for (const row of rows) {
      if (row.encrypted_password && (await bcrypt.compare(password, row.encrypted_password))) {
        user = row;
        break;
      }
    }
    if (!user) throw new HTTPException(401, { message: "invalid_credentials" });
    if (!user.email_confirmed_at) throw new HTTPException(403, { message: "not_confirmed" });
    if (user.banned_until && user.banned_until > new Date()) throw new HTTPException(403, { message: "banned" });

    await pool.query("UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1", [user.id]);
    return c.json(await session(toAuthUser(user), c.req.header("User-Agent")));
  })

  // Google sign-in (web: supabase.auth.signInWithIdToken / Lovable OAuth). Like Supabase, an unknown
  // Google account gets a new user with an empty profile; the app then signs it out on the login page
  // unless it finished registration (same isRegistered rule as the web).
  .post(
    "/google",
    zValidator(
      "json",
      z.object({
        idToken: z.string().min(20).max(5000),
        nonce: z.string().max(200).optional(),
        // "Register with Google" on step 3 of Register: the roles/specialties picked on steps 1–2.
        registration: z.object({ roles: registerBody.shape.roles, categoryIds: z.array(z.string().uuid()).max(50).default([]) }).optional(),
      }),
    ),
    async (c) => {
      const { idToken, nonce, registration } = c.req.valid("json");
      // A new account gets the picked roles in its metadata, so the profile trigger sets all five flags
      // (as for phone registration). The web set them afterwards, where the DB's privilege guard refuses
      // is_specialist, so "Register with Google" as a specialist didn't work there.
      const { user, created } = await findOrCreateGoogleUser(await verifyGoogleIdToken(idToken, nonce), registration?.roles ?? {});
      if (registration) {
        // Port of the web's applyPendingRegistration, run as the user like the web did (same RLS and RPCs).
        // Each step in its own savepoint, so one refusal doesn't undo the others; errors are only logged and
        // the sign-in still succeeds, as on the web.
        const { roles, categoryIds } = registration;
        const claims = { sub: user.id, role: "authenticated", aud: "authenticated", email: user.email, phone: user.phone } as const;
        await asUser(claims, async (_db, tx) => {
          const step = async (name: string, sql: string, params: unknown[]) => {
            await tx.query("SAVEPOINT reg");
            try {
              await tx.query(sql, params);
              await tx.query("RELEASE SAVEPOINT reg");
            } catch (err) {
              await tx.query("ROLLBACK TO SAVEPOINT reg");
              console.error(`[google] registration step ${name} failed:`, (err as Error).message);
            }
          };
          if (!created) {
            await step("roles", "SELECT public.update_my_role_flags($1, $2, $3, $4)", [roles.is_provider, roles.is_coordinator, roles.is_organization, roles.is_client]);
            if (roles.is_specialist) await step("specialist", "UPDATE public.profiles SET is_specialist = true WHERE id = $1", [user.id]);
          }
          for (const categoryId of categoryIds) {
            await step("category", "INSERT INTO public.user_categories (user_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.id, categoryId]);
          }
        }).catch((err) => console.error("[google] applying registration failed", err));
      }
      return c.json({ ...(await session(user, c.req.header("User-Agent"))), created });
    },
  )

  .post("/register", zValidator("json", registerBody), async (c) => {
    const body = c.req.valid("json");
    const email = phoneToEmail(body.phone);
    const phone = phoneE164(body.phone);

    const client = await pool.connect();
    let user: AuthUser;
    try {
      await client.query("BEGIN");
      const taken = await client.query("SELECT 1 FROM auth.users WHERE lower(email) = ANY($1)", [phoneLoginEmails(body.phone)]);
      if (taken.rowCount) throw new HTTPException(409, { message: "phone_taken" });

      const hash = await bcrypt.hash(normalizePassword(body.password), 10);
      // Same metadata shape Supabase stored; the on_auth_user_created trigger builds the profile from it.
      const meta = {
        email,
        phone,
        full_name: body.fullName,
        language: body.language,
        ...body.roles,
        email_verified: true,
        phone_verified: false,
      };
      user = await insertAuthUser(client, email, hash, meta);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    // These ran as the new user in the web app, so they go through RLS here too.
    const claims = { sub: user.id, role: "authenticated", aud: "authenticated", email: user.email, phone: user.phone } as const;
    await asUser(claims, async (_db, tx) => {
      for (const categoryId of body.categoryIds) {
        await tx.query("INSERT INTO public.user_categories (user_id, category_id) VALUES ($1, $2)", [user.id, categoryId]);
      }
    });
    if (body.inviteCode) {
      // Invalid codes are ignored, as in the web app.
      await asUser(claims, (_db, tx) => tx.query("SELECT public.record_invite_join($1)", [body.inviteCode])).catch(() => undefined);
    }

    return c.json(await session(user, c.req.header("User-Agent")), 201);
  })

  .post("/refresh", zValidator("json", z.object({ refreshToken: z.string().min(10) })), async (c) => {
    const rotated = await rotateRefreshToken(c.req.valid("json").refreshToken, c.req.header("User-Agent"));
    if (!rotated) throw new HTTPException(401, { message: "invalid_refresh_token" });
    const { rows } = await pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM auth.users WHERE id = $1 AND deleted_at IS NULL`,
      [rotated.userId],
    );
    const user = rows[0];
    if (!user || (user.banned_until && user.banned_until > new Date())) {
      await revokeRefreshToken(rotated.refreshToken);
      throw new HTTPException(401, { message: "invalid_refresh_token" });
    }
    const authUser = toAuthUser(user);
    return c.json({
      accessToken: await signAccessToken(authUser),
      refreshToken: rotated.refreshToken,
      expiresIn: ACCESS_TOKEN_TTL,
      user: authUser,
    });
  })

  .post("/logout", zValidator("json", z.object({ refreshToken: z.string().min(10) })), async (c) => {
    await revokeRefreshToken(c.req.valid("json").refreshToken);
    return c.json({ ok: true });
  })

  // Settings → Change password (web: supabase.auth.updateUser). Same padding rule as login.
  .post("/password", optionalAuth, requireAuth, zValidator("json", z.object({ password: z.string().min(1).max(200) })), async (c) => {
    const claims = c.get("claims")!;
    const hash = await bcrypt.hash(normalizePassword(c.req.valid("json").password), 10);
    await pool.query("UPDATE auth.users SET encrypted_password = $2, updated_at = now() WHERE id = $1", [claims.sub, hash]);
    return c.json({ ok: true });
  })

  // Settings → Change phone. Port of changeMyPhone in biz-link-droid/src/lib/account.functions.ts,
  // including its own normalisation (digits without leading zeros; "855" is not stripped there).
  .post(
    "/phone",
    optionalAuth,
    requireAuth,
    zValidator("json", z.object({ phone: z.string().trim().min(6).max(20).regex(/^[0-9+\-\s()]+$/) })),
    async (c) => {
      const claims = c.get("claims")!;
      const digits = c.req.valid("json").phone.replace(/\D/g, "").replace(/^0+/, "");
      if (digits.length < 6) throw new HTTPException(400, { message: "Invalid phone number" });
      const newEmail = `p${digits}@project001.local`;
      const normalizedPhone = `+855${digits}`;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const clash = await client.query(
          `SELECT 1 FROM public.profiles WHERE phone = $1 AND id <> $2
           UNION ALL SELECT 1 FROM auth.users WHERE lower(email) = $3 AND id <> $2`,
          [normalizedPhone, claims.sub, newEmail],
        );
        if (clash.rowCount) throw new HTTPException(409, { message: "This phone number is already in use" });
        await client.query(
          "UPDATE auth.users SET email = $2, phone = $3, email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE id = $1",
          [claims.sub, newEmail, digits],
        );
        await client.query("UPDATE public.profiles SET phone = $2 WHERE id = $1", [claims.sub, normalizedPhone]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
      return c.json({ ok: true });
    },
  )

  // Settings → Delete account (web: supabaseAdmin.auth.admin.deleteUser). Profile and content go with it via FKs.
  .delete("/account", optionalAuth, requireAuth, async (c) => {
    const claims = c.get("claims")!;
    await pool.query("DELETE FROM auth.users WHERE id = $1", [claims.sub]);
    return c.json({ ok: true });
  })

  .get("/me", optionalAuth, requireAuth, async (c) => {
    const claims = c.get("claims")!;
    // phone, is_admin, is_super_user and master_account_id are not readable column by column
    // (same grants as Supabase); the SECURITY DEFINER helpers return them for the caller only.
    const profile = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT p.id, p.full_name, p.avatar_url, p.about_me, p.language, p.member_number,
                p.is_provider, p.is_coordinator, p.is_organization, p.is_client, p.is_specialist,
                p.is_supplier, p.is_recruiter, p.is_verified, p.is_featured, p.created_at, p.updated_at,
                public.get_user_phone(p.id) AS phone, f.is_admin, f.is_super_user, f.master_account_id
         FROM public.profiles p LEFT JOIN public.get_my_profile_flags() f ON true
         WHERE p.id = $1`,
        [claims.sub],
      );
      return rows[0] ?? null;
    });
    return c.json({ user: { id: claims.sub, email: claims.email, phone: claims.phone }, profile });
  });
