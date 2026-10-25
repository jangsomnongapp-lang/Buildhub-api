import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(8787),
  /** Public base URL for uploaded media links. Unset in development: the request's own origin is used. */
  PUBLIC_URL: z.string().url().optional(),
  /** Where uploaded/migrated files are kept (served at /media/...). Default: ./storage. */
  MEDIA_DIR: z.string().default("storage"),
  /** Background jobs (src/jobs). On by default; JOBS=false turns them all off. */
  JOBS: z.stringbool().default(true),
  /** Send queued push notifications and admin Telegram alerts. Off by default: the local DB has real users' device tokens. */
  SEND_NOTIFICATIONS: z.stringbool().default(false),
});

export const env = schema.parse(process.env);
