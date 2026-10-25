// Supplier invite link (web: routes/supplier.join.$token.tsx). Works signed out: the page checks the
// token, and the final step creates the account (if needed), consumes the invite and adds the store.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool, asUser, type Claims } from "../db/client";
import { optionalAuth, type AuthEnv } from "../auth/middleware";
import { normalizePassword, phoneE164, phoneLoginEmails, phoneToEmail } from "../auth/phone";
import { insertAuthUser } from "../auth/users";
import { issueSession, type AuthUser } from "../auth/tokens";
import { toFileUrl } from "../media/inline";
import { publicBase } from "./uploads";

const tokenParam = z.object({ token: z.string().min(1).max(200) });

// The web carried the logo and photos as small data URLs (800 px, ≤ 250 KB), since there's no
// session to upload with before the account exists. Uploaded URLs are accepted too.
const image = z.string().max(400_000).refine((s) => /^data:image\/(jpeg|png|webp);base64,/.test(s) || /^https?:\/\//.test(s), "bad_image");

const submitBody = z.object({
  storeName: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).default(""),
  description: z.string().trim().max(150).default(""),
  logo: image.nullable().default(null),
  photos: z.array(image).max(5).default([]),
  categoryIds: z.array(z.string().uuid()).max(50).default([]),
  phone: z.string().max(40).optional(),
  password: z.string().max(200).optional(),
  language: z.enum(["km", "en"]).default("km"),
});

type InviteRow = { id: string; used_by: string | null; expires_at: string | null };
const inviteUsable = (row: InviteRow | undefined) => !!row && !row.used_by && !(row.expires_at && new Date(row.expires_at) < new Date());

export const supplierJoinRoutes = new Hono<AuthEnv>()
  .use(optionalAuth)

  // Same checks as the web: unknown, used or expired → invalid. Categories for step 1.
  .get("/:token", zValidator("param", tokenParam), async (c) => {
    const { token } = c.req.valid("param");
    return c.json(
      await asUser(c.get("claims"), async (_db, tx) => {
        const invite = await tx.query<InviteRow>("SELECT * FROM public.get_supplier_invite_by_token($1)", [token]);
        if (!inviteUsable(invite.rows[0])) return { valid: false, categories: [] };
        const cats = await tx.query("SELECT id, code, name_en, name_km FROM public.supplier_categories WHERE is_active ORDER BY sort_order");
        return { valid: true, categories: cats.rows };
      }),
    );
  })

  .post("/:token", zValidator("param", tokenParam), zValidator("json", submitBody), async (c) => {
    const { token } = c.req.valid("param");
    const body = c.req.valid("json");
    const signedIn = c.get("claims");
    if (!signedIn && (!body.phone?.trim() || !body.password)) throw new HTTPException(400, { message: "missing_fields" });

    // One transaction for everything (the web ran these as separate calls, so a failed store insert
    // left a new account with a used invite and no store).
    const client = await pool.connect();
    let newUser: AuthUser | null = null;
    let storeId: string;
    try {
      await client.query("BEGIN");
      let claims: Claims;
      let phone: string | null = null;
      if (signedIn) {
        claims = signedIn;
      } else {
        const ok = await client.query<InviteRow>("SELECT * FROM public.get_supplier_invite_by_token($1)", [token]);
        if (!inviteUsable(ok.rows[0])) throw new HTTPException(400, { message: "Invalid or already-used invite" });
        const taken = await client.query("SELECT 1 FROM auth.users WHERE lower(email) = ANY($1)", [phoneLoginEmails(body.phone!)]);
        if (taken.rowCount) throw new HTTPException(409, { message: "phone_taken" });
        const email = phoneToEmail(body.phone!);
        phone = phoneE164(body.phone!);
        const hash = await bcrypt.hash(normalizePassword(body.password!), 10);
        // Same metadata the web's signUp sent; the trigger ignores is_supplier (only the invite grants it).
        newUser = await insertAuthUser(client, email, hash, {
          email,
          phone,
          full_name: body.storeName,
          language: body.language,
          is_supplier: true,
          email_verified: true,
          phone_verified: false,
        });
        claims = { sub: newUser.id, role: "authenticated", aud: "authenticated", email: newUser.email, phone: newUser.phone };
      }

      // From here on as the user, so RLS applies like on the web.
      await client.query("SELECT set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      // Flips profiles.is_supplier, which the store insert policy requires.
      await client.query("SELECT public.consume_supplier_invite($1)", [token]);
      // The pictures arrive as data URLs (no upload before sign-in); keep only file links.
      const base = publicBase(c.req.url);
      const logo = await toFileUrl(body.logo, base);
      const photos = await Promise.all(body.photos.map((p) => toFileUrl(p, base)));
      const store = await client.query<{ id: string }>(
        `INSERT INTO public.supplier_stores (user_id, name, location, description, logo_url, phone, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
        [claims.sub, body.storeName, body.location || null, body.description || null, logo, phone],
      );
      storeId = store.rows[0].id;
      for (const cid of new Set(body.categoryIds)) {
        await client.query("INSERT INTO public.supplier_store_categories (store_id, category_id) VALUES ($1, $2)", [storeId, cid]);
      }
      for (const [i, url] of photos.entries()) {
        await client.query("INSERT INTO public.supplier_store_photos (store_id, photo_url, sort_order) VALUES ($1, $2, $3)", [storeId, url, i]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    return c.json({ storeId, session: newUser ? await issueSession(newUser, c.req.header("User-Agent")) : null }, 201);
  });
