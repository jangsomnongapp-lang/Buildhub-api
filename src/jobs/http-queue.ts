// Sends the HTTP calls that DB triggers queue with net.http_post (our stand-in for pg_net, see sql/001).
// On Supabase they went straight out; here the only one in use is the admin Telegram alert
// (new post / story / project / rental / report), a port of the web's /api/public/telegram-notify.
import { pool } from "../db/client";

const TELEGRAM_NOTIFY_PATH = "/api/public/telegram-notify";

/** Same reason as the push queue's max age: never deliver an old backlog. */
const MAX_AGE_MINUTES = 60;

function escapeHtml(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Copied from the web's telegram-notify route. */
export function buildTelegramMessage(kind: string, data: Record<string, unknown>): string {
  switch (kind) {
    case "report":
      return (
        `🚩 <b>New report</b>\n` +
        `From: ${escapeHtml(data.reporter_name)}\n` +
        `Target: ${escapeHtml(data.target_kind)} (${escapeHtml(data.target_id)})\n` +
        `Reason: ${escapeHtml(data.reason) || "—"}`
      );
    case "post":
      return (
        `📝 <b>New post</b>\n` +
        `By: ${escapeHtml(data.user_name)}\n` +
        `Status: ${escapeHtml(data.status)}\n` +
        (data.content ? `\n${escapeHtml(data.content)}` : "")
      );
    case "story":
      return (
        `📸 <b>New story</b>\n` +
        `By: ${escapeHtml(data.user_name)}\n` +
        `Status: ${escapeHtml(data.status)}` +
        (data.caption ? `\n${escapeHtml(data.caption)}` : "")
      );
    case "project":
      return (
        `💼 <b>New project</b>\n` +
        `By: ${escapeHtml(data.user_name)}\n` +
        `Title: ${escapeHtml(data.title)}\n` +
        `Status: ${escapeHtml(data.status)}`
      );
    case "rental":
      return (
        `🚜 <b>New rental listing</b>\n` +
        `By: ${escapeHtml(data.user_name)}\n` +
        `Title: ${escapeHtml(data.title)}\n` +
        `Category: ${escapeHtml(data.category)}\n` +
        `Price/day: $${escapeHtml(data.price_per_day)}\n` +
        `Status: ${escapeHtml(data.status)}`
      );
    default:
      return `🔔 <b>${escapeHtml(kind)}</b>\n${escapeHtml(JSON.stringify(data))}`;
  }
}

async function sendTelegramNotify(body: { kind?: string; chat_id?: string; data?: Record<string, unknown> } | null) {
  if (!body?.kind || !body.chat_id) return "missing_kind_or_chat_id";
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return "telegram_not_configured";
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: body.chat_id,
      text: buildTelegramMessage(body.kind, body.data ?? {}),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) return `telegram_${res.status}: ${(await res.text()).slice(0, 300)}`;
  return null;
}

/** Sends up to 50 queued requests, oldest first. `error` stays null when the call worked. */
export async function processHttpQueue() {
  const expired = await pool.query(
    `UPDATE net.http_request_queue SET processed_at = now(), error = 'expired'
     WHERE processed_at IS NULL AND created_at < now() - make_interval(mins => $1)`,
    [MAX_AGE_MINUTES],
  );
  const { rows } = await pool.query<{ id: string; url: string; body: Record<string, unknown> | null }>(
    `WITH picked AS (
       SELECT id FROM net.http_request_queue WHERE processed_at IS NULL
       ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED
     )
     UPDATE net.http_request_queue q SET processed_at = now() FROM picked WHERE q.id = picked.id
     RETURNING q.id, q.url, q.body`,
  );
  let failed = 0;
  for (const row of rows) {
    let error: string | null;
    try {
      error = new URL(row.url).pathname === TELEGRAM_NOTIFY_PATH ? await sendTelegramNotify(row.body) : "unsupported_url";
    } catch (err) {
      error = err instanceof Error ? err.message : "error";
    }
    if (error) {
      failed++;
      await pool.query("UPDATE net.http_request_queue SET error = $2 WHERE id = $1", [row.id, error]);
    }
  }
  return { processed: rows.length, failed, expired: expired.rowCount ?? 0 };
}
