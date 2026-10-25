# BuildHub API

Our own backend for the BuildHub Expo app. It replaces Supabase and uses the same PostgreSQL data.

**Stack:** Node.js 22 · Hono · Drizzle ORM · PostgreSQL 18 (portable, runs from `node_modules`)

## Run it locally
```bash
npm install
node scripts/db.mjs init      # first time only: creates .pgdata/ using the password in .env
npm run db:start              # start Postgres (port 5432)
npm run db:restore            # rebuild the `buildhub` DB from the Supabase dump (drops it first!)
npm run dev                   # API on http://localhost:8787 (restarts on file changes)
npm run test:auth             # end-to-end auth check with a throwaway account
npm run db:stop
```
`.env` (never commit it) holds `DATABASE_URL`, `PGPASSWORD`, `JWT_SECRET` and `PORT`. Optional: `TELEGRAM_BOT_TOKEN` (the password-reset bot; without it the Telegram webhook answers 500).

## How it works
- **Data:** `scripts/restore-dump.mjs` reads the Supabase `pg_dump -Fc` file directly (`scripts/pgdump-reader.mjs`, so no pg_restore is needed). It keeps the `public`, `auth` and `storage` schemas plus their grants, then applies `sql/*.sql` and `biz-link-droid/drizzle/migrations/*.sql`.
- **Permissions:** every user request runs through `asUser()` (`src/db/client.ts`). It switches to the `authenticated` or `anon` role and sets `request.jwt.claims`, so `auth.uid()` and all 205 Supabase RLS policies work unchanged. `adminDb` bypasses RLS and is only for auth and background jobs.
- **Hidden columns:** `profiles.phone`, `is_admin`, `is_super_user` and `master_account_id` are not readable directly (same grants as Supabase). Use `get_user_phone()` and `get_my_profile_flags()`.
- **Auth:** users stay in `auth.users`. Supabase's bcrypt hashes are verified as-is, so existing users keep their passwords. Phone numbers map to `p<digits>@project001.local`, and passwords shorter than 6 characters get the `Bh1!x9` suffix (`src/auth/phone.ts`); both must stay identical to the web app. Access tokens are HS256 JWTs valid for 1 hour. Refresh tokens are rotated on every use and stored hashed in `api.refresh_tokens`.
- **Realtime** (`src/realtime.ts`, `sql/003_realtime.sql`): one WebSocket at `/ws?token=<access token>` (closes with code 4001 when the token expires). Triggers on `messages` and `notifications` call `pg_notify('bh_events', …)` with ids only; the API LISTENs and forwards each event to the users concerned (`message`, `message_update`, `notification`). Chat presence (`{type:"presence", thread_id}`) is kept in memory, so it assumes one API process. `sql/004_realtime_more.sql` adds `project` events (to the owner and worker) and the public `feed` / `stories` / `listings` "something changed" events (to everyone, no ids). Check it with `npm run test:realtime`. After adding a `sql/*.sql` file, apply it with `npx tsx scripts/apply-sql.ts sql/<file>`
- **Supabase stand-ins** (`sql/001_supabase_compat.sql`): `net.http_post()` only queues requests in `net.http_request_queue` (Telegram alerts), and `vault.decrypted_secrets` reads from `vault.local_secrets`. Push notifications are queued in `public.push_notification_queue` by triggers.

## Endpoints so far
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/health` | | |
| POST | `/auth/login` | `{ phone, password }` or `{ email, password }` | → `{ accessToken, refreshToken, expiresIn, user }` |
| POST | `/auth/register` | `{ fullName, phone, password, language, roles, categoryIds, inviteCode? }` | 409 `phone_taken` |
| POST | `/auth/refresh` | `{ refreshToken }` | rotates the refresh token |
| POST | `/auth/logout` | `{ refreshToken }` | |
| GET | `/auth/me` | Bearer token | user + profile (with phone and admin flags) |
| POST | `/auth/password` | `{ password }` | change password (same short-password padding) |
| POST | `/auth/phone` | `{ phone }` | change phone; 409 if used by someone else |
| DELETE | `/auth/account` | Bearer | deletes the user (profile and content cascade) |
| GET | `/me/shell` | Bearer token | `{ unreadAlerts, unreadMessages, myStoreId }` for the app frame |
| GET | `/feed/home?page=0` | Bearer | 20 posts + 20 rentals per page with likes, comment counts, supplier info |
| GET | `/feed/stories`, `/feed/followed-store-owners`, `/feed/posts/:id` | Bearer | |
| PUT | `/posts/:id/reaction` | `{ reaction: "like"\|"love"\|"haha"\|"wow"\|"sad"\|null }` | |
| PATCH / DELETE | `/posts/:id` | `{ content }` | 403 if not allowed by RLS |
| PUT | `/rentals/:id/like` | `{ liked }` | |
| POST | `/reports` | `{ targetKind, targetId, reason? }` | |
| POST | `/stories/:id/view` | | counts once per viewer |
| GET | `/messages/threads` | Bearer | inbox: other user, unread count, light preview |
| POST | `/messages/threads` | `{ otherUserId, storeId? }` | → `{ threadId }` (find or create) |
| GET | `/messages/threads/:id?after=<iso>` | Bearer | thread + messages; `after` = only newer ones (+ `readIds`) |
| GET | `/messages/threads/:id/pinned?pin=post:<id>` | Bearer | item the chat is about (post/rental/listing/store) |
| POST | `/messages/threads/:id/messages` | `{ content }` | up to 8 MB (attachments are inline data: URLs) |
| POST | `/messages/threads/:id/read` | Bearer | marks the other person's messages read |
| GET / POST | `/listings` | `{ title, description?, location?, budget?, currency, categoryIds, photos }` | list = 20 newest active (60 days) + `appliedIds`; create = `pending` |
| GET / PATCH / DELETE | `/listings/:id` | `{ title, description, location, budget }` | detail includes `postedCount`, `applied`, owner-only `applicants` |
| POST | `/listings/:id/apply`, `/listings/:id/finish`, `/listings/:id/applications/:appId/accept` | | finish creates a completed project when a worker was accepted → `{ project }` |
| POST | `/projects/:id/rating` | `{ stars, comment? }` | other side of a completed project |
| POST | `/auth/google` | `{ idToken, nonce?, registration?: { roles, categoryIds } }` | Google ID token → session (+ `created`); finds or creates the user like Supabase; `registration` = Register with Google |
| POST | `/join/:code` | | public; invite link: `{ valid }`, counts the click |
| PUT / DELETE | `/me/device-token` | `{ token, platform }` / `{ token }` | the app's Expo push token (`ExponentPushToken[…]`) |
| GET | `/reference/categories` | | public |
| POST | `/uploads/:folder` | multipart `file` | → `{ url }`; folders: listings, posts, stories, avatars, portfolio, rentals, marketplace, suppliers, projects, materials |
| GET | `/media/...` | | uploaded files |
| GET / POST | `/comments/:kind/:id` | `{ content, parentId? }` | kind = `post` or `rental` |
| PATCH / DELETE | `/comments/:kind/c/:id` | `{ content }` | |
| PUT | `/comments/:kind/c/:id/like` | `{ liked }` | |

Local test account: `node scripts/seed-test-user.mjs` (the details are in that file).

Errors are returned as `{ "error": "<code>" }`.

## Moving files out of Supabase Storage (`scripts/migrate-storage.ts`)
Photos and videos are not in the DB dump; the DB only holds Supabase URLs (and bare paths for the private buckets).
- `npx tsx scripts/migrate-storage.ts`: dry run (what's referenced, sizes, what's already downloaded). Downloads nothing
- `--download`: copies every referenced file to `storage/media/supabase/<bucket>/<path>` (served at `/media/supabase/...`). Public buckets by URL; private ones need `SUPABASE_SERVICE_KEY`. Safe to re-run
- `--rewrite --base https://<public API URL>`: points the DB at the copies, in one transaction, only for files that were downloaded
Run it at the switch-over against the production database.

## Background jobs (`src/jobs/`, were pg_cron on Supabase)
They start with the API (`startJobs()` in `src/index.ts`) and tick at the start of every minute, in UTC like pg_cron. A Postgres advisory lock per job means only one API instance runs a job at a time, and a slow run is skipped instead of overlapping.

| Schedule (UTC) | Job name | What it does |
|---|---|---|
| hourly | `expire-claims` | `SELECT public.expire_overdue_claims()` |
| 03:00 daily | `expire-stale-listings` | active listings older than 60 days → `expired` |
| 05:00 daily | `auto-run-draws` | `SELECT public.auto_run_due_draws()` (also creates the next scheduled draws) |
| every minute | `push-queue` | sends `push_notification_queue` via Expo or FCM (port of the web's `/api/public/process-push-queue`) |
| every minute | `http-queue` | sends what triggers queued with `net.http_post`: the admin Telegram alerts (port of `/api/public/telegram-notify`) |

Settings (`.env`):
- `JOBS=false` turns all jobs off (default on).
- `SEND_NOTIFICATIONS=true` turns on `push-queue` and `http-queue` (default **off**: the local DB is a copy of production, with real people's device tokens and the real admin Telegram group).
- `FCM_SERVICE_ACCOUNT_JSON` (full Firebase service-account JSON) for FCM tokens; Expo tokens need nothing. `TELEGRAM_BOT_TOKEN` for the Telegram alerts (the web sent them through Lovable's gateway, so the bot must be a member of the admin group).
- Not in the web: queue rows older than 60 minutes are marked failed (`expired`) instead of sent, so turning sending on never delivers an old backlog.

Run one job by hand: `npx tsx scripts/run-job.ts <name>` (`push-queue`/`http-queue` really send).
