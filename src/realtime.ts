// Realtime over one WebSocket per signed-in app (replaces the web's Supabase realtime channels).
//
// - Connect to ws(s)://<api>/ws?token=<access token>. The socket closes when that token expires
//   (code 4001), and the app reconnects with a fresh one.
// - Server → client: {type:"message"|"message_update", thread_id, message_id, sender_id} for chats I'm in,
//   {type:"notification"} for my alerts, {type:"presence", thread_id, online:[userIds]},
//   {type:"project", project_id} for projects I'm in (sql/004), and to everyone {type:"feed"|"stories"|"listings"}
//   when those public tables change (no ids: screens just refetch).
// - Client → server: {type:"presence", thread_id} while a chat is open, {type:"presence", thread_id:null} when it closes.
//   Like the web, "online" means the other person has this chat open right now.
//
// Events come from Postgres triggers (sql/003_realtime.sql) via LISTEN bh_events. Presence is kept in this
// process's memory, so it assumes a single API process (fine for now; a second process would need Redis or similar).
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import pg from "pg";
import { decodeJwt } from "jose";
import { WebSocketServer, type WebSocket } from "ws";
import { env } from "./env";
import { pool } from "./db/client";
import { verifyAccessToken } from "./auth/tokens";

interface Client {
  ws: WebSocket;
  userId: string;
  viewing: string | null;
  alive: boolean;
}

const byUser = new Map<string, Set<Client>>();
const viewers = new Map<string, Set<Client>>(); // thread id → clients that have it open

function send(c: Client, data: unknown) {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(data));
}

function sendToUsers(userIds: string[], data: unknown) {
  for (const id of new Set(userIds)) for (const c of byUser.get(id) ?? []) send(c, data);
}

/** Tells both participants who has the thread open. */
async function broadcastPresence(threadId: string) {
  const online = [...new Set([...(viewers.get(threadId) ?? [])].map((c) => c.userId))];
  const t = await pool.query<{ participant_a: string; participant_b: string }>(
    "SELECT participant_a, participant_b FROM public.message_threads WHERE id = $1",
    [threadId],
  );
  if (t.rows[0]) sendToUsers([t.rows[0].participant_a, t.rows[0].participant_b], { type: "presence", thread_id: threadId, online });
}

function leaveThread(c: Client) {
  const prev = c.viewing;
  if (!prev) return;
  c.viewing = null;
  const set = viewers.get(prev);
  set?.delete(c);
  if (set && !set.size) viewers.delete(prev);
  void broadcastPresence(prev).catch(() => undefined);
}

async function onClientMessage(c: Client, raw: string) {
  let msg: { type?: string; thread_id?: string | null };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.type !== "presence") return;
  const threadId = typeof msg.thread_id === "string" && /^[0-9a-f-]{36}$/i.test(msg.thread_id) ? msg.thread_id : null;
  if (threadId === c.viewing) return;
  leaveThread(c);
  if (!threadId) return;
  // Only participants can join a thread's presence.
  const ok = await pool.query("SELECT 1 FROM public.message_threads WHERE id = $1 AND $2 IN (participant_a, participant_b)", [threadId, c.userId]);
  if (!ok.rowCount || c.ws.readyState !== c.ws.OPEN) return;
  c.viewing = threadId;
  if (!viewers.has(threadId)) viewers.set(threadId, new Set());
  viewers.get(threadId)!.add(c);
  await broadcastPresence(threadId);
}

/** LISTEN on a dedicated connection; reconnects after errors. */
function listen() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  const retry = () => {
    client.removeAllListeners();
    void client.end().catch(() => undefined);
    setTimeout(listen, 3000);
  };
  client.on("error", (e) => {
    console.error("realtime LISTEN connection lost:", e.message);
    retry();
  });
  client.on("notification", (n) => {
    if (n.channel !== "bh_events" || !n.payload) return;
    try {
      const { users, all, ...event } = JSON.parse(n.payload) as { users?: string[]; all?: boolean; type: string };
      if (all) for (const set of byUser.values()) for (const c of set) send(c, event);
      else sendToUsers(users ?? [], event);
    } catch {
      // ignore malformed payloads
    }
  });
  client
    .connect()
    .then(() => client.query("LISTEN bh_events"))
    .catch((e) => {
      console.error("realtime LISTEN failed:", (e as Error).message);
      retry();
    });
}

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") return socket.destroy();
    const token = url.searchParams.get("token") ?? "";
    verifyAccessToken(token)
      .then((claims) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          const c: Client = { ws, userId: claims.sub, viewing: null, alive: true };
          if (!byUser.has(c.userId)) byUser.set(c.userId, new Set());
          byUser.get(c.userId)!.add(c);
          // Close when the access token expires; the app reconnects with a refreshed one.
          const exp = decodeJwt(token).exp;
          const expiry = exp ? setTimeout(() => ws.close(4001, "token_expired"), Math.max(0, exp * 1000 - Date.now())) : null;
          ws.on("pong", () => (c.alive = true));
          ws.on("message", (data) => void onClientMessage(c, data.toString()).catch(() => undefined));
          ws.on("close", () => {
            if (expiry) clearTimeout(expiry);
            leaveThread(c);
            byUser.get(c.userId)?.delete(c);
            if (!byUser.get(c.userId)?.size) byUser.delete(c.userId);
          });
          send(c, { type: "ready" });
        });
      })
      .catch(() => {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      });
  });

  // Drop sockets that stopped answering pings (phones going offline without closing).
  setInterval(() => {
    for (const set of byUser.values())
      for (const c of set) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
  }, 30_000).unref();

  listen();
}
