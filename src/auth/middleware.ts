import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Claims } from "../db/client";
import { verifyAccessToken } from "./tokens";

export type AuthEnv = { Variables: { claims: Claims | null } };

/** Reads the Bearer token if present. Routes decide whether a user is required. */
export const optionalAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  let claims: Claims | null = null;
  if (header?.startsWith("Bearer ")) {
    try {
      claims = await verifyAccessToken(header.slice(7));
    } catch {
      throw new HTTPException(401, { message: "invalid_token" });
    }
  }
  c.set("claims", claims);
  await next();
});

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  if (!c.get("claims")) throw new HTTPException(401, { message: "not_authenticated" });
  await next();
});

/** requireAuth, except for GET requests whose full path matches one of `publicPaths` (pages the web shows signed out). */
export const requireAuthExceptGet = (...publicPaths: RegExp[]) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const isPublic = c.req.method === "GET" && publicPaths.some((p) => p.test(c.req.path));
    if (!c.get("claims") && !isPublic) throw new HTTPException(401, { message: "not_authenticated" });
    await next();
  });
