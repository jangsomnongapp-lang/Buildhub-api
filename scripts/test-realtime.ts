// End-to-end check of the realtime WebSocket with the two local test accounts (API must be running):
//   npx tsx scripts/test-realtime.ts
// Test Client opens the chat with Test Worker, Test Worker sends a message, and both should get the events.
import WebSocket from "ws";

const API = process.env.API_URL ?? "http://localhost:8787";
const WS = API.replace(/^http/, "ws");

async function login(phone: string) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, password: "test1234" }) });
  const b = (await r.json()) as { accessToken: string; user: { id: string } };
  return { token: b.accessToken, id: b.user.id };
}

function connect(name: string, token: string, log: string[]) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`${WS}/ws?token=${token}`);
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      log.push(`${name} ← ${m.type}${m.online ? " online=" + m.online.length : ""}`);
      if (m.type === "ready") resolve(ws);
    });
    ws.on("unexpected-response", (_req, res) => reject(new Error(`${name}: HTTP ${res.statusCode}`)));
    ws.on("error", reject);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log: string[] = [];

// A bad token is refused.
await connect("bad", "nope", log).then(
  () => log.push("bad token: ACCEPTED (wrong)"),
  (e) => log.push(`bad token: refused (${(e as Error).message})`),
);

const worker = await login("099000222");
const client = await login("099000333");
const wWs = await connect("worker", worker.token, log);
const cWs = await connect("client", client.token, log);

const auth = (t: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
const { threadId } = (await (await fetch(`${API}/messages/threads`, { method: "POST", headers: auth(worker.token), body: JSON.stringify({ otherUserId: client.id }) })).json()) as {
  threadId: string;
};

cWs.send(JSON.stringify({ type: "presence", thread_id: threadId }));
await wait(300);
wWs.send(JSON.stringify({ type: "presence", thread_id: threadId }));
await wait(300);
await fetch(`${API}/messages/threads/${threadId}/messages`, { method: "POST", headers: auth(worker.token), body: JSON.stringify({ content: "realtime test" }) });
await wait(300);
await fetch(`${API}/messages/threads/${threadId}/read`, { method: "POST", headers: auth(client.token) });
await wait(300);
cWs.send(JSON.stringify({ type: "presence", thread_id: null }));
await wait(300);

console.log(log.join("\n"));
wWs.close();
cWs.close();
