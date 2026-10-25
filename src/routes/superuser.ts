// Super-user panel (web: routes/superuser.panel.tsx + lib/super-user.functions.ts). A super user runs several
// "identities" (linked accounts) and can switch into any of them. Everything here ran with the service key
// on the web, so it uses the owner pool after the same checks:
// - the caller resolves to a master: itself if is_super_user, or its master (if super user or admin) when it's an identity;
// - switching, phone logins etc. only ever target the master or accounts linked to it (master_account_id).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";
import { issueSession } from "../auth/tokens";
import { insertAuthUser } from "../auth/users";
import { normalizePhone, phoneLoginEmails } from "../auth/phone";

type Flags = { id: string; is_admin: boolean; is_super_user: boolean; master_account_id: string | null };

/** The master account the caller acts for, or null when the caller isn't a super user (web: assertSuperUser). */
async function masterOf(userId: string): Promise<string | null> {
  const me = (await pool.query<Flags>("SELECT id, is_admin, is_super_user, master_account_id FROM public.profiles WHERE id = $1", [userId])).rows[0];
  if (me?.master_account_id) {
    const master = (await pool.query<Flags>("SELECT id, is_admin, is_super_user, master_account_id FROM public.profiles WHERE id = $1", [me.master_account_id]))
      .rows[0];
    if (master?.is_super_user || master?.is_admin) return master.id;
  }
  return me?.is_super_user ? me.id : null;
}

async function requireMaster(userId: string) {
  const id = await masterOf(userId);
  if (!id) throw new HTTPException(403, { message: "Forbidden: not a super user" });
  return id;
}

/** Same as the web's phoneToEmail in super-user.functions.ts (digits only, no normalisation). */
const identityPhoneEmail = (phone: string) => `p${phone.replace(/\D/g, "")}@project001.local`;

export const superUserRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Identities with their profile and unread count (messages to the identity that it hasn't read).
  // Non-super users get { forbidden: true } and the app shows a 404, as on the web.
  .get("/identities", async (c) => {
    const masterId = await masterOf(c.get("claims")!.sub);
    if (!masterId) return c.json({ forbidden: true, masterId: null, identities: [] });
    const { rows } = await pool.query(
      `SELECT i.id, i.identity_user_id, i.display_order, i.avatar_shape, i.is_official, i.badges, i.description,
         CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url) END AS profile,
         (SELECT count(*)::int FROM public.messages m JOIN public.message_threads t ON t.id = m.thread_id
           WHERE (t.participant_a = i.identity_user_id OR t.participant_b = i.identity_user_id)
             AND m.read_at IS NULL AND m.sender_id <> i.identity_user_id) AS unread
       FROM public.super_user_identities i LEFT JOIN public.profiles p ON p.id = i.identity_user_id
       WHERE i.master_user_id = $1 ORDER BY i.display_order`,
      [masterId],
    );
    return c.json({ forbidden: false, masterId, identities: rows });
  })

  // New identity: an account with a synthetic email and a random password, linked to the master.
  .post(
    "/identities",
    zValidator(
      "json",
      z.object({
        full_name: z.string().trim().min(1).max(120),
        description: z.string().max(300).default(""),
        avatar_shape: z.enum(["circle", "square"]).default("circle"),
        user_type: z.enum(["worker", "company", "supplier", "client", "specialist"]),
        location: z.string().max(120).default(""),
        badges: z.array(z.string().max(40)).max(8).default([]),
      }),
    ),
    async (c) => {
      const masterId = await requireMaster(c.get("claims")!.sub);
      const b = c.req.valid("json");
      const email = `identity-${masterId.slice(0, 8)}-${Math.random().toString(36).slice(2, 10)}@buildhub.local`;
      const hash = await bcrypt.hash(randomUUID() + randomUUID(), 10);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const user = await insertAuthUser(client, email, hash, {
          email,
          full_name: b.full_name,
          language: "km",
          is_provider: b.user_type === "worker",
          is_specialist: b.user_type === "specialist",
          is_organization: b.user_type === "company",
          is_client: b.user_type === "client",
          email_verified: true,
        });
        await client.query(
          "UPDATE public.profiles SET full_name = $2, about_me = $3, avatar_url = NULL, master_account_id = $4, is_supplier = $5 WHERE id = $1",
          [user.id, b.full_name, b.description, masterId, b.user_type === "supplier"],
        );
        const row = await client.query(
          `INSERT INTO public.super_user_identities (master_user_id, identity_user_id, display_order, avatar_shape, badges, description)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [masterId, user.id, 100 + (Math.floor(Date.now() / 1000) % 10000), b.avatar_shape, b.badges, b.description],
        );
        await client.query("COMMIT");
        return c.json({ ok: true, identity: row.rows[0] }, 201);
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
  )

  // Switch into the master or one of its identities: returns a normal session for that account
  // (the web issued a one-time magic link and swapped the Supabase session).
  .post("/switch", zValidator("json", z.object({ target_user_id: z.string().uuid() })), async (c) => {
    const masterId = await requireMaster(c.get("claims")!.sub);
    const { target_user_id } = c.req.valid("json");
    const target = (await pool.query<{ id: string; master_account_id: string | null }>("SELECT id, master_account_id FROM public.profiles WHERE id = $1", [target_user_id]))
      .rows[0];
    if (!target) throw new HTTPException(404, { message: "Target not found" });
    if (target.id !== masterId && target.master_account_id !== masterId) throw new HTTPException(403, { message: "Forbidden" });
    const u = (
      await pool.query<{ id: string; email: string | null; phone: string | null; banned_until: Date | null }>(
        "SELECT id, email, phone, banned_until FROM auth.users WHERE id = $1 AND deleted_at IS NULL",
        [target_user_id],
      )
    ).rows[0];
    if (!u?.email) throw new HTTPException(400, { message: "Identity has no email" });
    if (u.banned_until && u.banned_until > new Date()) throw new HTTPException(403, { message: "Identity is banned" });
    return c.json(await issueSession({ id: u.id, email: u.email, phone: u.phone }, c.req.header("User-Agent")));
  })

  // Latest 100 threads across the master and all its identities, with unread counts.
  .get("/inbox", async (c) => {
    const masterId = await requireMaster(c.get("claims")!.sub);
    const { rows } = await pool.query(
      `WITH ids AS (SELECT id FROM public.profiles WHERE id = $1 OR master_account_id = $1),
       th AS (
         SELECT t.id, t.last_message, t.last_message_at,
           CASE WHEN t.participant_a IN (SELECT id FROM ids) THEN t.participant_a ELSE t.participant_b END AS owner,
           CASE WHEN t.participant_a IN (SELECT id FROM ids) THEN t.participant_b ELSE t.participant_a END AS other
         FROM public.message_threads t
         WHERE t.participant_a IN (SELECT id FROM ids) OR t.participant_b IN (SELECT id FROM ids)
         ORDER BY t.last_message_at DESC NULLS LAST LIMIT 100)
       SELECT th.id AS thread_id, th.owner AS identity_id, po.full_name AS identity_name, po.avatar_url AS identity_avatar,
         th.other AS other_id, px.full_name AS other_name, px.avatar_url AS other_avatar, th.last_message, th.last_message_at,
         (SELECT count(*)::int FROM public.messages m WHERE m.thread_id = th.id AND m.read_at IS NULL AND m.sender_id <> th.owner) AS unread
       FROM th LEFT JOIN public.profiles po ON po.id = th.owner LEFT JOIN public.profiles px ON px.id = th.other
       ORDER BY th.last_message_at DESC NULLS LAST`,
      [masterId],
    );
    return c.json({ threads: rows });
  })

  // Give an identity its own phone + password login (anyone using it lands on that identity).
  .post(
    "/identities/phone",
    zValidator("json", z.object({ identity_user_id: z.string().uuid(), phone: z.string().min(6).max(20), password: z.string().min(6).max(72) })),
    async (c) => {
      const masterId = await requireMaster(c.get("claims")!.sub);
      const b = c.req.valid("json");
      const target = (await pool.query<{ master_account_id: string | null }>("SELECT master_account_id FROM public.profiles WHERE id = $1", [b.identity_user_id]))
        .rows[0];
      if (!target || target.master_account_id !== masterId) throw new HTTPException(404, { message: "Identity not found" });
      const email = identityPhoneEmail(b.phone);
      // Stricter than the web (which compared the typed text with profiles.phone only): refuse the number when any
      // other account already logs in with it in any stored format, so a real user's login can't be shadowed.
      const local = normalizePhone(b.phone);
      const taken = await pool.query(
        `SELECT 1 FROM public.profiles WHERE id <> $2 AND phone = ANY($1)
         UNION ALL SELECT 1 FROM auth.users WHERE id <> $2 AND lower(email) = ANY($3)`,
        [[b.phone, `+855${local}`, `+8550${local}`, `0${local}`, local], b.identity_user_id, [email, ...phoneLoginEmails(b.phone)]],
      );
      if (taken.rowCount) throw new HTTPException(409, { message: "Phone number already in use" });
      const hash = await bcrypt.hash(b.password, 10);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE auth.users SET email = $2, encrypted_password = $3, email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE id = $1",
          [b.identity_user_id, email, hash],
        );
        await client.query("UPDATE public.profiles SET phone = $2 WHERE id = $1", [b.identity_user_id, b.phone]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
      return c.json({ ok: true });
    },
  );
