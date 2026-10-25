// Projects (web: lib/projects.functions.ts): rating, status changes, the project page and new requests.
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asUser } from "../db/client";
import { optionalAuth, requireAuth, type AuthEnv } from "../auth/middleware";

export const projectRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Port of submitRating: rate the other side of a completed project.
  .post(
    "/:id/rating",
    zValidator("param", z.object({ id: z.string().uuid() })),
    zValidator("json", z.object({ stars: z.number().int().min(1).max(5), comment: z.string().max(100).nullable().optional() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { stars, comment } = c.req.valid("json");
      await asUser(claims, async (_db, tx) => {
        const { rows } = await tx.query<{ owner_id: string; worker_id: string; status: string }>(
          "SELECT owner_id, worker_id, status FROM public.projects WHERE id = $1",
          [id],
        );
        const p = rows[0];
        if (!p) throw new HTTPException(404, { message: "Not found" });
        if (p.status !== "completed") throw new HTTPException(400, { message: "Project not completed" });
        const ratedId = claims.sub === p.owner_id ? p.worker_id : p.owner_id;
        await tx.query("INSERT INTO public.project_ratings (project_id, rater_id, rated_id, stars, comment) VALUES ($1, $2, $3, $4, $5)", [
          id,
          claims.sub,
          ratedId,
          stars,
          comment || null,
        ]);
      });
      return c.json({ ok: true }, 201);
    },
  );

const projectParam = z.object({ id: z.string().uuid() });

// Project terms (createProjectRequest / configureProject).
const photoFrequency = z.union([z.enum(["morning", "midday", "endofday"]), z.array(z.enum(["morning", "midday", "endofday"]))]).nullable().optional();
const termsSchema = z.object({
  agreedPrice: z.number().nonnegative().nullable().optional(),
  checkinRequired: z.boolean().optional(),
  checkoutRequired: z.boolean().optional(),
  photoFrequency,
  startDate: z.string().date().nullable().optional(),
  duration: z.string().max(100).nullable().optional(),
});
type Terms = z.infer<typeof termsSchema>;

/** Same as the web's normalizePhotoFrequency: an array is stored comma-joined. */
function normalizePhotoFrequency(v: Terms["photoFrequency"]): string | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    const uniq = Array.from(new Set(v));
    return uniq.length ? uniq.join(",") : null;
  }
  return v;
}
const termParams = (t: Terms) => [
  t.agreedPrice ?? null,
  !!t.checkinRequired,
  !!t.checkoutRequired,
  normalizePhotoFrequency(t.photoFrequency),
  t.startDate || null,
  t.duration || null,
];


// Project status changes from the "Project control" list (web: lib/projects.functions.ts).
type ProjectRow = { owner_id: string; worker_id: string; status: string; completion_requested_by: string | null };

function projectAction(check: (p: ProjectRow, me: string) => void, update: (me: string) => { set: string; params: unknown[] }) {
  return async (c: Context<AuthEnv>) => {
    const claims = c.get("claims")!;
    const { id } = projectParam.parse(c.req.param());
    await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query<ProjectRow>("SELECT owner_id, worker_id, status, completion_requested_by FROM public.projects WHERE id = $1", [id]);
      const p = rows[0];
      if (!p) throw new HTTPException(404, { message: "Not found" });
      check(p, claims.sub);
      const { set, params } = update(claims.sub);
      await tx.query(`UPDATE public.projects SET ${set} WHERE id = $1`, [id, ...params]);
    });
    return c.json({ ok: true });
  };
}

const fail = (message: string): never => {
  throw new HTTPException(400, { message });
};
const participant = (p: ProjectRow, me: string) => {
  if (p.owner_id !== me && p.worker_id !== me) fail("Not a participant");
};

export const projectStatusRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)
  .post(
    "/:id/request-completion",
    projectAction(
      (p, me) => {
        participant(p, me);
        if (p.status !== "active") fail("Project must be active");
      },
      (me) => ({ set: "completion_requested_by = $2", params: [me] }),
    ),
  )
  .post(
    "/:id/force-complete",
    projectAction(
      (p, me) => {
        participant(p, me);
        if (p.status !== "active") fail("Project must be active");
        if (p.completion_requested_by !== me) fail("Request completion first");
      },
      () => ({ set: "status = 'completed', completion_requested_by = NULL", params: [] }),
    ),
  )
  .post(
    "/:id/cancel-pending",
    projectAction(
      (p, me) => {
        if (p.owner_id !== me) fail("Only the owner can cancel");
        if (p.status !== "pending") fail("Not pending");
      },
      () => ({ set: "status = 'cancelled'", params: [] }),
    ),
  )
  .post(
    "/:id/cancel-completion",
    projectAction(participant, () => ({ set: "completion_requested_by = NULL", params: [] })),
  )
  .post(
    "/:id/confirm-completion",
    projectAction(
      (p, me) => {
        if (p.status !== "active" && !(p.status === "completed" && p.completion_requested_by)) fail("Not active");
        if (!p.completion_requested_by) fail("Nothing to confirm");
        if (p.completion_requested_by === me) fail("The other party must confirm");
      },
      () => ({ set: "status = 'completed', completion_requested_by = NULL", params: [] }),
    ),
  )

  // Port of respondToProject: the worker accepts or declines a pending request.
  .post("/:id/respond", zValidator("json", z.object({ accept: z.boolean() })), async (c) => {
    const { accept } = c.req.valid("json");
    return projectAction(
      (p, me) => {
        if (p.worker_id !== me) fail("Only the worker can respond");
        if (p.status !== "pending") fail("Already handled");
      },
      () => ({ set: "status = $2", params: [accept ? "active" : "declined"] }),
    )(c);
  })

  // Port of configureProject: the owner sets the terms; the worker must confirm again (back to pending).
  .post("/:id/configure", zValidator("json", termsSchema), async (c) => {
    const t = c.req.valid("json");
    return projectAction(
      (p, me) => {
        if (p.owner_id !== me) fail("Only the owner can configure");
        if (p.status !== "active" && p.status !== "pending") fail("Project must be accepted first");
      },
      () => ({
        set: `agreed_price = $2, checkin_required = $3, checkout_required = $4, photo_frequency = $5, start_date = $6, duration = $7,
              setup_completed = true, status = 'pending', completion_requested_by = NULL`,
        params: termParams(t),
      }),
    )(c);
  });

// Project page (web: routes/projects.$projectId.tsx) and start-a-project (projects.new.$workerId.tsx).
export const projectSpaceRoutes = new Hono<AuthEnv>()
  .use(optionalAuth, requireAuth)

  // Port of createProjectRequest.
  .post("/", zValidator("json", termsSchema.extend({ workerId: z.string().uuid() })), async (c) => {
    const claims = c.get("claims")!;
    const b = c.req.valid("json");
    if (b.workerId === claims.sub) throw new HTTPException(400, { message: "You cannot start a project with yourself" });
    const id = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO public.projects (owner_id, worker_id, status, agreed_price, checkin_required, checkout_required, photo_frequency, start_date, duration, setup_completed)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, true) RETURNING id`,
        [claims.sub, b.workerId, ...termParams(b)],
      );
      return rows[0].id;
    });
    return c.json({ id }, 201);
  })

  // Everything the project page shows: the project, both people, logs (newest 50), chat (oldest first, 200), ratings.
  .get("/:id", zValidator("param", projectParam), async (c) => {
    const claims = c.get("claims")!;
    const { id } = c.req.valid("param");
    const data = await asUser(claims, async (_db, tx) => {
      const { rows } = await tx.query(
        `SELECT id, owner_id, worker_id, status, agreed_price::float AS agreed_price, checkin_required, checkout_required, photo_frequency,
           start_date::text AS start_date, duration, completion_requested_by, setup_completed, created_at
         FROM public.projects WHERE id = $1`,
        [id],
      );
      const project = rows[0];
      if (!project) return null;
      const people = await tx.query("SELECT id, full_name, avatar_url FROM public.profiles WHERE id = ANY($1)", [[project.owner_id, project.worker_id]]);
      const logs = await tx.query(
        "SELECT id, user_id, log_type, photo_url, created_at FROM public.project_logs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 50",
        [id],
      );
      const messages = await tx.query(
        "SELECT id, sender_id, content, created_at FROM public.project_messages WHERE project_id = $1 ORDER BY created_at LIMIT 200",
        [id],
      );
      const ratings = await tx.query("SELECT id, rater_id, rated_id, stars, comment FROM public.project_ratings WHERE project_id = $1", [id]);
      const byId = new Map(people.rows.map((p) => [p.id, p]));
      return {
        project,
        owner: byId.get(project.owner_id) ?? null,
        worker: byId.get(project.worker_id) ?? null,
        logs: logs.rows,
        messages: messages.rows,
        ratings: ratings.rows,
      };
    });
    if (!data) throw new HTTPException(404, { message: "Not found" });
    return c.json(data);
  })

  // Check in / check out / progress photo (photo already uploaded through /uploads/projects).
  .post(
    "/:id/logs",
    zValidator("param", projectParam),
    zValidator("json", z.object({ type: z.enum(["checkin", "checkout", "photo"]), photoUrl: z.string().url().max(2000).optional() })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { type, photoUrl } = c.req.valid("json");
      if (type === "photo" && !photoUrl) throw new HTTPException(400, { message: "photoUrl required" });
      const row = await asUser(claims, async (_db, tx) =>
        (
          await tx.query(
            "INSERT INTO public.project_logs (project_id, user_id, log_type, photo_url) VALUES ($1, $2, $3, $4) RETURNING id, user_id, log_type, photo_url, created_at",
            [id, claims.sub, type, type === "photo" ? photoUrl : null],
          )
        ).rows[0],
      );
      return c.json(row, 201);
    },
  )

  .post(
    "/:id/messages",
    zValidator("param", projectParam),
    zValidator("json", z.object({ content: z.string().trim().min(1).max(4000) })),
    async (c) => {
      const claims = c.get("claims")!;
      const { id } = c.req.valid("param");
      const { content } = c.req.valid("json");
      const row = await asUser(claims, async (_db, tx) =>
        (
          await tx.query(
            "INSERT INTO public.project_messages (project_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, sender_id, content, created_at",
            [id, claims.sub, content],
          )
        ).rows[0],
      );
      return c.json(row, 201);
    },
  );
