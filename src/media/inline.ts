// Pictures sent as base64 data: URLs (the web's profile photos, shop logos, chat images) are saved as
// files and replaced by their link, so feeds and chats don't carry ~100 KB of text per picture.
// Files are named by their content hash (storage/media/inline/<hash>.<ext>), so the same picture is
// stored once and can be cached forever. Only images are converted; anything else stays as it is.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MEDIA_ROOT, sniff } from "../routes/uploads";

const DATA_URL = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)$/;

/** Saves a data:image URL as a file and returns its link under `base`, or null when it isn't an image data URL. */
export async function saveDataUrl(value: string, base: string): Promise<string | null> {
  const m = DATA_URL.exec(value);
  if (!m) return null;
  const bytes = new Uint8Array(Buffer.from(m[1], "base64"));
  const type = sniff(bytes);
  if (type?.kind !== "image") return null;
  const rel = `media/inline/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${type.ext}`;
  const file = join(MEDIA_ROOT, rel);
  if (!existsSync(file)) {
    await mkdir(join(MEDIA_ROOT, "media", "inline"), { recursive: true });
    await writeFile(file, bytes);
  }
  return `${base.replace(/\/$/, "")}/${rel}`;
}

/** Same, but returns the value unchanged when it isn't an image data URL. */
export async function toFileUrl(value: string, base: string): Promise<string>;
export async function toFileUrl(value: string | null, base: string): Promise<string | null>;
export async function toFileUrl(value: string | null, base: string) {
  if (!value) return value;
  return (await saveDataUrl(value, base)) ?? value;
}

/** Chat message prefixes and the JSON field that can hold a picture: image attachments and shared post/shop cards. */
const PICTURE_FIELDS: [prefix: string, field: string][] = [
  ["__ATT__:", "url"],
  ["__REF__:", "photo_url"],
];

/** Chat message: a picture inside an attachment or a shared card (`__ATT__:{"url":"data:..."}`) gets a file link instead. */
export async function messageToFileUrls(content: string, base: string): Promise<string> {
  if (!content.includes("data:image/")) return content;
  const match = PICTURE_FIELDS.find(([prefix]) => content.startsWith(prefix));
  if (!match) return content;
  const [prefix, field] = match;
  try {
    const data = JSON.parse(content.slice(prefix.length)) as Record<string, unknown>;
    const value = data[field];
    if (typeof value !== "string") return content;
    const url = await saveDataUrl(value, base);
    return url ? prefix + JSON.stringify({ ...data, [field]: url }) : content;
  } catch {
    return content;
  }
}
