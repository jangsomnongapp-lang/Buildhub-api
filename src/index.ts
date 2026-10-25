import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { env } from "./env";
import { pool } from "./db/client";
import { authRoutes } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { feedRoutes } from "./routes/feed";
import { actionRoutes } from "./routes/actions";
import { commentRoutes } from "./routes/comments";
import { messageRoutes } from "./routes/messages";
import { listingRoutes, referenceRoutes } from "./routes/listings";
import { MEDIA_ROOT, uploadRoutes } from "./routes/uploads";
import { projectRoutes, projectSpaceRoutes, projectStatusRoutes } from "./routes/projects";
import { profileRoutes } from "./routes/profiles";
import { workerRoutes } from "./routes/workers";
import { contentRoutes } from "./routes/content";
import { marketRoutes } from "./routes/market";
import { materialRoutes } from "./routes/materials";
import { storeRoutes } from "./routes/stores";
import { rentalRoutes } from "./routes/rentals";
import { notificationRoutes } from "./routes/notifications";
import { searchRoutes } from "./routes/search";
import { invitationRoutes, joinRoutes } from "./routes/invitations";
import { rewardRoutes } from "./routes/rewards";
import { adminRoutes } from "./routes/admin";
import { superUserRoutes } from "./routes/superuser";
import { supplierJoinRoutes } from "./routes/supplier-join";
import { blogRoutes } from "./routes/blog";
import type { Server } from "node:http";
import { attachRealtime } from "./realtime";
import { passwordResetRoutes, telegramResetWebhook } from "./routes/password-reset";
import { serveStatic } from "@hono/node-server/serve-static";
import { startJobs } from "./jobs";
import { aiRoutes } from "./routes/ai";

const app = new Hono()
  .use(logger())
  .use(cors())
  .get("/health", async (c) => {
    await pool.query("SELECT 1");
    return c.json({ ok: true });
  })
  .route("/auth/password-reset", passwordResetRoutes)
  .route("/telegram/password-reset", telegramResetWebhook)
  .route("/auth", authRoutes)
  .route("/me/content", contentRoutes)
  .route("/me", meRoutes)
  .route("/feed", feedRoutes)
  .route("/comments", commentRoutes)
  .route("/messages", messageRoutes)
  .route("/listings", listingRoutes)
  .route("/reference", referenceRoutes)
  .route("/projects", projectRoutes)
  .route("/projects", projectStatusRoutes)
  .route("/projects", projectSpaceRoutes)
  .route("/profiles", profileRoutes)
  .route("/workers", workerRoutes)
  .route("/search", searchRoutes)
  .route("/invitations", invitationRoutes)
  .route("/join", joinRoutes)
  .route("/ai", aiRoutes)
  .route("/rewards", rewardRoutes)
  .route("/admin", adminRoutes)
  .route("/superuser", superUserRoutes)
  .route("/supplier-join", supplierJoinRoutes)
  .route("/blog", blogRoutes)
  .route("/market", marketRoutes)
  .route("/materials", materialRoutes)
  .route("/stores", storeRoutes)
  .route("/rentals", rentalRoutes)
  .route("/notifications", notificationRoutes)
  .route("/uploads", uploadRoutes)
  // Uploaded media: file names are random UUIDs, so they can be cached forever.
  .use(
    "/media/*",
    serveStatic({
      root: MEDIA_ROOT,
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  )
  .route("/", actionRoutes);

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  // A CHECK constraint or a trigger's RAISE EXCEPTION rejected the input: a client error, shown like the web showed Supabase's message.
  const code = (err as { code?: string }).code;
  if (code === "23514" || code === "P0001") return c.json({ error: err.message }, 400);
  // Duplicate row (e.g. answering a request twice) and RLS refusals, also with the DB message.
  if (code === "23505") return c.json({ error: err.message }, 409);
  if (code === "42501") return c.json({ error: err.message }, 403);
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export type AppType = typeof app;

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`BuildHub API listening on http://localhost:${info.port}`);
});
attachRealtime(server as unknown as Server);
startJobs();
