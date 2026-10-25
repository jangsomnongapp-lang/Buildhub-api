// Forgot password through Telegram. Port of biz-link-droid/src/lib/password-reset.functions.ts (request + verify)
// and src/routes/api/public/telegram-password-reset.ts (the bot's webhook).
//
// Flow: the app sends the phone → we store a reset row and return a t.me link with a one-time start token →
// the user opens the bot, which sends /start <token> to our webhook → we ask them to share their contact →
// if the shared number matches, we send a 6-digit code in Telegram → the app sends code + new password.
//
// The web called Telegram through Lovable's connector gateway. We call the Bot API directly with
// TELEGRAM_BOT_TOKEN (unset = the webhook answers 500 "Not configured", as the web did without its key).
// The webhook must be registered with secret_token = sha256("telegram-webhook:" + TELEGRAM_BOT_TOKEN).
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db/client";
import { normalizePassword, normalizePhone } from "../auth/phone";

const TELEGRAM_BOT_USERNAME = "Jangsomnong_bot";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function phoneLookupVariants(digits: string) {
  return [`+855${digits}`, `+8550${digits}`, `0${digits}`, digits];
}

async function telegramCall(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram ${method} failed (${response.status}): ${await response.text()}`);
}

export const passwordResetRoutes = new Hono()
  // Step 1. No account check is revealed: a phone without an account still gets a link (the bot then refuses).
  .post("/request", zValidator("json", z.object({ phone: z.string().min(6).max(20) })), async (c) => {
    const digits = normalizePhone(c.req.valid("json").phone);
    if (digits.length < 6) throw new HTTPException(400, { message: "Invalid phone" });

    const recent = await pool.query<{ created_at: Date }>(
      "SELECT created_at FROM public.telegram_password_resets WHERE phone_digits = $1 ORDER BY created_at DESC LIMIT 1",
      [digits],
    );
    if (recent.rows[0] && Date.now() - recent.rows[0].created_at.getTime() < 60_000)
      throw new HTTPException(429, { message: "Please wait before requesting another code" });

    const profile = await pool.query<{ id: string }>("SELECT id FROM public.profiles WHERE phone = ANY($1) LIMIT 1", [phoneLookupVariants(digits)]);
    const resetId = randomUUID();
    const startToken = randomBytes(24).toString("base64url");
    await pool.query(
      `INSERT INTO public.telegram_password_resets (id, user_id, phone_digits, start_token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
      [resetId, profile.rows[0]?.id ?? null, digits, hash(startToken)],
    );
    return c.json({ resetId, botUrl: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${startToken}` });
  })

  // Step 2. Five wrong codes lock the reset. Sessions already signed in stay signed in, as with Supabase.
  .post(
    "/verify",
    zValidator(
      "json",
      z.object({ resetId: z.string().uuid(), code: z.string().regex(/^\d{6}$/), newPassword: z.string().min(1).max(72) }),
    ),
    async (c) => {
      const { resetId, code, newPassword } = c.req.valid("json");
      const { rows } = await pool.query<{
        id: string;
        user_id: string | null;
        code_hash: string | null;
        expires_at: Date;
        attempts: number;
        telegram_chat_id: string | null;
      }>(
        "SELECT id, user_id, code_hash, expires_at, attempts, telegram_chat_id FROM public.telegram_password_resets WHERE id = $1 AND used_at IS NULL",
        [resetId],
      );
      const row = rows[0];
      if (!row?.user_id || !row.code_hash || !row.telegram_chat_id) throw new HTTPException(400, { message: "Invalid code" });
      if (row.expires_at.getTime() < Date.now()) throw new HTTPException(400, { message: "Code expired" });
      if (row.attempts >= 5) throw new HTTPException(400, { message: "Too many attempts" });

      if (!safeEqual(hash(`${row.id}:${code}`), row.code_hash)) {
        await pool.query("UPDATE public.telegram_password_resets SET attempts = attempts + 1 WHERE id = $1", [row.id]);
        throw new HTTPException(400, { message: "Invalid code" });
      }

      const pwHash = await bcrypt.hash(normalizePassword(newPassword), 10);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Mark used first and only if still unused, so the same code can't be spent twice in parallel.
        const used = await client.query("UPDATE public.telegram_password_resets SET used_at = now() WHERE id = $1 AND used_at IS NULL", [row.id]);
        if (!used.rowCount) throw new HTTPException(400, { message: "Invalid code" });
        await client.query(
          "UPDATE auth.users SET encrypted_password = $2, email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE id = $1",
          [row.user_id, pwHash],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      return c.json({ ok: true });
    },
  );

const TelegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      chat: z.object({ id: z.number().int() }),
      from: z.object({ id: z.number().int() }).optional(),
      text: z.string().max(500).optional(),
      contact: z.object({ phone_number: z.string().min(6).max(30), user_id: z.number().int().optional() }).optional(),
    })
    .optional(),
});

async function handleStart(chatId: number, token: string) {
  const { rows } = await pool.query<{ id: string; expires_at: Date; used_at: Date | null }>(
    "SELECT id, expires_at, used_at FROM public.telegram_password_resets WHERE start_token_hash = $1",
    [hash(token)],
  );
  const reset = rows[0];
  if (!reset || reset.used_at || reset.expires_at.getTime() < Date.now()) {
    await telegramCall("sendMessage", {
      chat_id: chatId,
      text: "តំណនេះផុតកំណត់។ សូមស្នើសុំម្តងទៀតក្នុង BuildHub។\n\nThis link has expired. Please request another one in BuildHub.",
    });
    return;
  }
  await pool.query("UPDATE public.telegram_password_resets SET telegram_chat_id = $2 WHERE id = $1", [reset.id, chatId]);
  await telegramCall("sendMessage", {
    chat_id: chatId,
    text: "សូមចុចប៊ូតុងខាងក្រោម ដើម្បីផ្ទៀងផ្ទាត់លេខទូរស័ព្ទរបស់អ្នក។\n\nTap the button below to verify your phone number.",
    reply_markup: {
      keyboard: [[{ text: "📱 ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ / Verify phone", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function handleContact(chatId: number, senderId: number | undefined, contact: { phone_number: string; user_id?: number }) {
  // Only the sender's own contact counts, not a forwarded one.
  if (!senderId || contact.user_id !== senderId) {
    await telegramCall("sendMessage", {
      chat_id: chatId,
      text: "សូមចែករំលែកលេខផ្ទាល់ខ្លួនរបស់អ្នកដោយប្រើប៊ូតុងផ្ទៀងផ្ទាត់។\n\nPlease share your own number using the verification button.",
    });
    return;
  }
  const { rows } = await pool.query<{
    id: string;
    phone_digits: string;
    user_id: string | null;
    expires_at: Date;
    used_at: Date | null;
    last_sent_at: Date | null;
  }>(
    `SELECT id, phone_digits, user_id, expires_at, used_at, last_sent_at FROM public.telegram_password_resets
     WHERE telegram_chat_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [chatId],
  );
  const reset = rows[0];
  if (!reset || reset.used_at || !reset.user_id || normalizePhone(contact.phone_number) !== reset.phone_digits || reset.expires_at.getTime() < Date.now()) {
    await telegramCall("sendMessage", {
      chat_id: chatId,
      text: "មិនអាចផ្ទៀងផ្ទាត់លេខនេះបានទេ។ សូមពិនិត្យលេខក្នុង BuildHub ហើយព្យាយាមម្តងទៀត។\n\nWe could not verify this number. Check the number in BuildHub and try again.",
      reply_markup: { remove_keyboard: true },
    });
    return;
  }
  if (reset.last_sent_at && Date.now() - reset.last_sent_at.getTime() < 60_000) return;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query("UPDATE public.telegram_password_resets SET code_hash = $2, last_sent_at = now() WHERE id = $1", [reset.id, hash(`${reset.id}:${code}`)]);
  await telegramCall("sendMessage", {
    chat_id: chatId,
    text: `លេខកូដកំណត់ពាក្យសម្ងាត់របស់អ្នកគឺ: ${code}\nផុតកំណត់ក្នុង ១០ នាទី។\n\nYour BuildHub password reset code is: ${code}\nIt expires in 10 minutes.`,
    reply_markup: { remove_keyboard: true },
  });
}

// Telegram's webhook for the reset bot.
export const telegramResetWebhook = new Hono().post("/", async (c) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return c.text("Not configured", 500);
  const provided = c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!safeEqual(provided, hash(`telegram-webhook:${token}`))) return c.text("Unauthorized", 401);

  const parsed = TelegramUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !parsed.data.message) return c.json({ ok: true, ignored: true });
  const message = parsed.data.message;
  const startToken = message.text?.match(/^\/start\s+([A-Za-z0-9_-]{20,100})$/)?.[1];
  if (startToken) await handleStart(message.chat.id, startToken);
  else if (message.contact) await handleContact(message.chat.id, message.from?.id, message.contact);
  return c.json({ ok: true });
});
