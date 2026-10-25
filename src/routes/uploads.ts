// Media uploads (web: lib/media-upload.ts, which wrote to the public Supabase bucket "rental-photos").
// Files land in storage/media/<userId>/<folder>/<uuid>.<ext> and are served at /media/... .
// Only the URL goes into the database, as on the web.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";
import { env } from "../env";

/** Folder holding storage/media/... (a persistent volume when hosted, e.g. Railway: MEDIA_DIR=/data). */
export const MEDIA_ROOT = env.MEDIA_DIR;

const FOLDERS = new Set(["listings", "posts", "stories", "avatars", "portfolio", "rentals", "marketplace", "suppliers", "projects", "materials"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

/** Base for media links. Phones reach the dev PC by its LAN IP, so without PUBLIC_URL the link uses the address the request came in on. */
export function publicBase(requestUrl: string) {
  return (env.PUBLIC_URL ?? new URL(requestUrl).origin).replace(/\/$/, "");
}

/** Detects the real file type from its first bytes; the client-sent type is not trusted. */
export function sniff(b: Uint8Array): { kind: "image" | "video"; ext: string; mime: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", ext: "jpg", mime: "image/jpeg" };
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return { kind: "image", ext: "png", mime: "image/png" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { kind: "image", ext: "webp", mime: "image/webp" };
  if (ascii(0, 4) === "GIF8") return { kind: "image", ext: "gif", mime: "image/gif" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: "video", ext: "webm", mime: "video/webm" };
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    return brand.startsWith("qt") ? { kind: "video", ext: "mov", mime: "video/quicktime" } : { kind: "video", ext: "mp4", mime: "video/mp4" };
  }
  return null;
}

export const uploadRoutes = new Hono<AuthEnv>().post(
  "/:folder",
  optionalAuth,
  requireAuth,
  bodyLimit({ maxSize: MAX_VIDEO_BYTES + 1024 * 1024, onError: () => { throw new HTTPException(413, { message: "file_too_large" }); } }),
  async (c) => {
    const claims = c.get("claims")!;
    const folder = c.req.param("folder");
    if (!FOLDERS.has(folder)) throw new HTTPException(400, { message: "bad_folder" });

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: "file_missing" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniff(bytes);
    if (!type) throw new HTTPException(415, { message: "unsupported_file_type" });
    if (bytes.length > (type.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES)) throw new HTTPException(413, { message: "file_too_large" });

    const rel = `media/${claims.sub}/${folder}/${randomUUID()}.${type.ext}`;
    await mkdir(join(MEDIA_ROOT, "media", claims.sub, folder), { recursive: true });
    await writeFile(join(MEDIA_ROOT, rel), bytes);
    return c.json({ url: `${publicBase(c.req.url)}/${rel}`, type: type.mime }, 201);
  },
);
