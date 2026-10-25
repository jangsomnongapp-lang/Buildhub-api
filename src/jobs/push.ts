// Port of the web's /api/public/process-push-queue worker plus its Expo and FCM senders
// (biz-link-droid/src/routes/api/public/process-push-queue.ts, lib/expoPush.server.ts, lib/fcm.server.ts).
// DB triggers fill push_notification_queue; this sends the pending rows.
import { importPKCS8, SignJWT } from "jose";
import { pool } from "../db/client";

interface SendResult {
  token: string;
  ok: boolean;
  status: number;
  errorCode?: string;
}

interface Payload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Same channel the Android app registers (high priority, sound). */
const ANDROID_CHANNEL = "buildhub_high_v2";

/**
 * Rows older than this are marked failed instead of sent. Not in the web worker: added so that
 * turning sending on (or a restored dump) doesn't deliver a backlog of stale notifications.
 */
const MAX_AGE_MINUTES = 60;

export async function sendExpoPush(token: string, payload: Payload): Promise<SendResult> {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify([
      {
        to: token,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        sound: "default",
        priority: "high",
        channelId: ANDROID_CHANNEL,
      },
    ]),
  });
  if (res.status === 429) console.warn("Expo push rate limited");
  const json = (await res.json().catch(() => null)) as {
    data?: Array<{ status: "ok" | "error"; message?: string; details?: { error?: string } }>;
  } | null;
  const ticket = json?.data?.[0];
  if (!ticket) return { token, ok: false, status: res.status, errorCode: `HTTP_${res.status}` };
  if (ticket.status === "ok") return { token, ok: true, status: 200 };
  return { token, ok: false, status: res.status, errorCode: ticket.details?.error ?? ticket.message ?? "error" };
}

let fcmAccess: { token: string; exp: number; projectId: string } | null = null;

async function fcmAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (fcmAccess && fcmAccess.exp > now + 60) return fcmAccess;
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FCM_SERVICE_ACCOUNT_JSON is not set");
  const sa = JSON.parse(raw.trim()) as { client_email: string; private_key: string; project_id: string; token_uri: string };
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(sa.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  fcmAccess = { token: json.access_token, exp: now + json.expires_in, projectId: sa.project_id };
  return fcmAccess;
}

export async function sendFcmPush(deviceToken: string, payload: Payload): Promise<SendResult> {
  const { token, projectId } = await fcmAccessToken();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
        android: {
          priority: "high",
          notification: {
            sound: "default",
            channel_id: ANDROID_CHANNEL,
            notification_priority: "PRIORITY_HIGH",
            default_sound: true,
            default_vibrate_timings: true,
          },
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: { aps: { sound: "default", "content-available": 1, "interruption-level": "time-sensitive" } },
        },
      },
    }),
  });
  if (res.ok) return { token: deviceToken, ok: true, status: res.status };
  const err = (await res.json().catch(() => null)) as {
    error?: { status?: string; details?: Array<{ errorCode?: string }> };
  } | null;
  const errorCode = err?.error?.details?.find((d) => d.errorCode)?.errorCode ?? err?.error?.status ?? `HTTP_${res.status}`;
  return { token: deviceToken, ok: false, status: res.status, errorCode };
}

const DEAD_TOKEN_CODES = new Set(["UNREGISTERED", "INVALID_ARGUMENT", "DeviceNotRegistered", "InvalidCredentials"]);

/** Sends up to 100 pending rows, oldest first. Same steps and statuses as the web worker. */
export async function processPushQueue() {
  const expired = await pool.query(
    `UPDATE push_notification_queue SET status = 'failed', error_message = 'expired', processed_at = now()
     WHERE status = 'pending' AND created_at < now() - make_interval(mins => $1)`,
    [MAX_AGE_MINUTES],
  );

  // Claim atomically so two workers can never send the same push twice.
  const { rows } = await pool.query<{
    id: string;
    device_token: string;
    title: string;
    body: string | null;
    data: Record<string, string> | null;
    provider: string | null;
  }>(
    `WITH picked AS (
       SELECT id FROM push_notification_queue WHERE status = 'pending'
       ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
     )
     UPDATE push_notification_queue q SET status = 'processing' FROM picked WHERE q.id = picked.id
     RETURNING q.id, q.device_token, q.title, q.body, q.data,
       (SELECT provider FROM device_tokens d WHERE d.token = q.device_token LIMIT 1) AS provider`,
  );
  if (rows.length === 0) return { processed: 0, expired: expired.rowCount ?? 0 };

  let sent = 0;
  let failed = 0;
  const deadTokens: string[] = [];
  for (const row of rows) {
    let result: SendResult | null = null;
    const payload = { title: row.title, body: row.body ?? "", data: row.data ?? {} };
    try {
      if (row.provider === "expo") result = await sendExpoPush(row.device_token, payload);
      else if (row.provider === "fcm") result = await sendFcmPush(row.device_token, payload);
    } catch (err) {
      console.error("push send failed", err);
      result = { token: row.device_token, ok: false, status: 0, errorCode: err instanceof Error ? err.message : "error" };
    }
    // Rows whose token has no known provider fail so they don't block the queue forever.
    const errorMessage = result ? (result.ok ? null : (result.errorCode ?? "unknown")) : "unknown_provider";
    if (result?.ok) sent++;
    else failed++;
    if (result && !result.ok && (DEAD_TOKEN_CODES.has(result.errorCode ?? "") || result.status === 404 || result.status === 400)) {
      deadTokens.push(row.device_token);
    }
    await pool.query(
      "UPDATE push_notification_queue SET status = $2, error_message = $3, processed_at = now() WHERE id = $1",
      [row.id, result?.ok ? "sent" : "failed", errorMessage],
    );
  }
  if (deadTokens.length > 0) await pool.query("DELETE FROM device_tokens WHERE token = ANY($1)", [deadTokens]);

  return { processed: rows.length, sent, failed, pruned: deadTokens.length, expired: expired.rowCount ?? 0 };
}
