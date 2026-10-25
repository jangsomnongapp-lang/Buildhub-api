// Points the Telegram bot (password-reset codes) at this API. Run once at the switch-over, with the hosted
// API's address. This takes the bot away from the old website, so only run it when the app is going live.
//   TELEGRAM_BOT_TOKEN=… npx tsx scripts/set-telegram-webhook.ts https://<api address>
//   npx tsx scripts/set-telegram-webhook.ts --info      (shows where the bot points now; changes nothing)
import "dotenv/config";
import { createHash } from "node:crypto";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
const call = async (method: string, body?: unknown) =>
  (await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })).json();

if (process.argv.includes("--info")) {
  console.log(await call("getWebhookInfo"));
} else {
  const base = process.argv[2];
  if (!base || !/^https:\/\//.test(base)) throw new Error("Give the API's https address, e.g. https://api.buildhubkh.com");
  // Same secret the webhook route checks (routes/password-reset.ts).
  const secret = createHash("sha256").update(`telegram-webhook:${token}`).digest("hex");
  console.log(await call("setWebhook", { url: `${base.replace(/\/$/, "")}/telegram/password-reset`, secret_token: secret, allowed_updates: ["message"] }));
}
