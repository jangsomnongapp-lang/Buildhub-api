// Google Gemini (the user's choice, 2026-10-14). The web called the same Gemini models through Lovable's AI
// gateway (OpenAI format) and AI search called Gemini directly; this uses Gemini's own generateContent API,
// which takes images and PDFs inline, so remote photos are fetched here and sent as bytes.
//   GEMINI_API_KEY      required (unset → 503 "ai_unavailable")
//   GEMINI_MODEL        default gemini-3.5-flash-lite (photos, price lists, auto-fill). The user chose the lite
//                       model on 2026-10-15: gemini-3.8-flash allows only 20 free requests a day. Set
//                       GEMINI_MODEL=gemini-3.8-flash for better answers once billing is on.
//   GEMINI_LITE_MODEL   default gemini-3.5-flash-lite (AI search, text only)
import { HTTPException } from "hono/http-exception";

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
export const LITE_MODEL = () => process.env.GEMINI_LITE_MODEL || "gemini-3.5-flash-lite";

export function aiConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

/** A data: URL → inline part (images and PDFs). Returns null for anything else. */
export function dataUrlPart(dataUrl: string | undefined): Part | null {
  const m = dataUrl?.match(/^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s);
  if (!m) return null;
  if (!/^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/.test(m[1])) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

/** Downloads a photo (supplier post photos) for inline use; null if it can't be fetched or isn't an image. */
export async function urlImagePart(url: string): Promise<Part | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) return null;
    return { inline_data: { mime_type: type, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

interface Options {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask for JSON (optionally with a schema in Gemini's OpenAPI-subset format). */
  json?: boolean | Record<string, unknown>;
}

// Gemini 3 models think before answering, and thought tokens count against maxOutputTokens: with the small
// limits below (120 for picture keywords) the answer got cut off mid-thought. So thinking is kept "low" and
// gets its own headroom on top of each caller's answer limit. If a model rejects the setting, it's dropped.
const THINKING_HEADROOM = 2048;
let thinkingSupported = true;

/** One user turn → the reply text. Retries twice on 429/503 like the web's AI search did. */
export async function generate(parts: Part[], opts: Options = {}, attempt = 0): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HTTPException(503, { message: "ai_unavailable" });
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0,
    maxOutputTokens: (opts.maxTokens ?? 1000) + THINKING_HEADROOM,
  };
  if (thinkingSupported) generationConfig.thinkingConfig = { thinkingLevel: "low" };
  if (opts.json) {
    generationConfig.responseMimeType = "application/json";
    if (typeof opts.json === "object") generationConfig.responseSchema = opts.json;
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${opts.model ?? MODEL()}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    signal: AbortSignal.timeout(60_000),
  });
  if ((res.status === 429 || res.status === 503) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    return generate(parts, opts, attempt + 1);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    if (res.status === 400 && thinkingSupported && /thinking/i.test(detail)) {
      thinkingSupported = false;
      return generate(parts, opts, attempt);
    }
    console.error("Gemini error", res.status, detail);
    throw new Error(res.status === 429 || res.status === 503 ? "AI is busy right now. Please try again in a minute." : `AI request failed (${res.status})`);
  }
  const payload = (await res.json()) as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") console.warn("Gemini reply cut off (MAX_TOKENS)");
  const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  // The lite model sometimes writes "Khmer" names in Thai script or slips Korean letters in. The app only uses
  // Khmer and English, so those letters are always wrong: drop them (an all-Thai name ends up empty for the
  // user to type, instead of being saved wrong). Safe inside JSON: they only ever appear in string values.
  return text.replace(/[฀-๿ᄀ-ᇿ㄰-㆏가-힯]+/g, "").replace(/ {2,}/g, " ");
}

/** First {...} block of a reply (models sometimes wrap JSON in code fences). */
export function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI returned no structured data");
  return JSON.parse(match[0]);
}
