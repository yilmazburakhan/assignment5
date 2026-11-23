// Burakhan Yılmaz, 2200005240
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "./db.ts";
import { tasks, users } from "./schema.ts";
import {
  checkPassword,
  type Env,
  hashPassword,
  requireAuth,
  requireRole,
  type Role,
  signToken,
  verifyToken,
} from "./auth.ts";
import { LoginRateLimiter, WsHub } from "./live.ts";
import { Pool } from "./pool.ts";

const ErrorSchema = z.object({
  error: z.string(),
  issues: z.array(z.unknown()).optional(),
  requestId: z.string().optional(),
});

const OkSchema = z.object({ ok: z.boolean() });
const ReadySchema = z.object({ ready: z.boolean() });

const CredentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

const RegisteredUserSchema = z.object({
  id: z.number(),
  email: z.string(),
});

const TokenSchema = z.object({
  token: z.string(),
});

const TaskSchema = z.object({
  id: z.number(),
  userId: z.number(),
  title: z.string(),
  status: z.enum(["todo", "in-progress", "done"]),
  priority: z.enum(["low", "medium", "high"]),
  dueDate: z.string().nullable(),
  deletedAt: z.number().nullable(),
  attachment: z.string().nullable(),
  createdAt: z.number(),
});

const TaskBodySchema = z.object({
  title: z.string().trim().min(1).max(100),
  status: z.enum(["todo", "in-progress", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

const TaskQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["todo", "in-progress", "done"]).optional(),
});

const TaskListSchema = z.object({
  items: z.array(TaskSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});

const SummarySchema = z.object({
  todo: z.number(),
  "in-progress": z.number(),
  done: z.number(),
});

const AdminUsersSchema = z.object({
  users: z.array(
    z.object({
      id: z.number(),
      email: z.string(),
      role: z.enum(["user", "admin"]),
      createdAt: z.number(),
    }),
  ),
});

const IdParamSchema = z.object({
  id: z.string(),
});

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

const MAX_ATTACHMENT_BYTES = 1_000_000;
const TASK_CACHE_TTL_MS = 60_000;

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function contentTypeFromFilename(filename: string): string {
  return filename.endsWith(".png") ? "image/png" : "image/jpeg";
}

const SWAGGER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Tasks API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui" });
    };
  </script>
</body>
</html>`;

export async function registerUserInTx(
  dbConn: Db,
  email: string,
  passwordHash: string,
  beforeWelcome?: () => void,
  role: Role = "user",
) {
  return await dbConn.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ email, passwordHash, role })
      .returning({ id: users.id, email: users.email, role: users.role });
    if (!created) throw new Error("failed to create user");
    beforeWelcome?.();
    await tx.insert(tasks).values({
      userId: created.id,
      title: "Welcome!",
      status: "todo",
      priority: "medium",
    });
    return created;
  });
}

export function createApp(
  dbConn: Db,
  pool?: Pool<Db>,
  uploadsDir = "./uploads",
  kv?: Deno.Kv,
) {
  const { db } = dbConn;
  const activePool = pool ?? new Pool([dbConn]);
  const wsHub = new WsHub();
  const rateLimiter = new LoginRateLimiter();

  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { error: "validation failed", issues: result.error.issues },
          400,
        );
      }
    },
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    const start = performance.now();
    await next();
    c.header("x-request-id", requestId);
    console.log(
      JSON.stringify({
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - start),
      }),
    );
  });

  app.get("/ws", async (c) => {
    const token = c.req.query("token") ?? "";
    const verified = await verifyToken(token);
    if (verified === null) return c.json({ error: "unauthorized" }, 401);
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    socket.onopen = () => wsHub.add(verified.userId, socket);
    socket.onclose = () => wsHub.remove(verified.userId, socket);
    return response;
  });

  const healthRoute = createRoute({
    method: "get",
    path: "/health",
    responses: {
      200: {
        content: { "application/json": { schema: OkSchema } },
        description: "Health check",
      },
    },
  });
  app.openapi(healthRoute, (c) => c.json({ ok: true }, 200));

  const healthzRoute = createRoute({
    method: "get",
    path: "/healthz",
    responses: {
      200: {
        content: { "application/json": { schema: OkSchema } },
        description: "Liveness check",
      },
    },
  });
  app.openapi(healthzRoute, (c) => c.json({ ok: true }, 200));

  const readyzRoute = createRoute({
    method: "get",
    path: "/readyz",
    responses: {
      200: {
        content: { "application/json": { schema: ReadySchema } },
        description: "Database is ready",
      },
      503: {
        content: { "application/json": { schema: ReadySchema } },
        description: "Database is unavailable",
      },
    },
  });
  app.openapi(readyzRoute, async (c) => {
    try {
      await db.run(sql`SELECT 1`);
      return c.json({ ready: true }, 200);
    } catch {
      return c.json({ ready: false }, 503);
    }
  });

  const registerRoute = createRoute({
    method: "post",
    path: "/auth/register",
    request: {
      body: {
        content: { "application/json": { schema: CredentialsSchema } },
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: RegisteredUserSchema } },
        description: "User registered",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Validation failed",
      },
      409: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Email already exists",
      },
    },
  });
  app.openapi(registerRoute, async (c) => {
    const { email, password } = c.req.valid("json");
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing) {
      return c.json({ error: "email already exists" }, 409);
    }

    const adminEmail = Deno.env.get("ADMIN_EMAIL");
    const role: Role = adminEmail && email === adminEmail ? "admin" : "user";
    const passwordHash = await hashPassword(password);
    const created = await registerUserInTx(dbConn, email, passwordHash, undefined, role);

    return c.json({ id: created.id, email: created.email }, 201);
  });

  const loginRoute = createRoute({
    method: "post",
    path: "/auth/login",
    request: {
      body: {
        content: { "application/json": { schema: CredentialsSchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: TokenSchema } },
        description: "JWT token issued",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Validation failed",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Invalid email or password",
      },
      429: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Too many login attempts",
      },
    },
  });
  app.openapi(loginRoute, async (c) => {
    const { email, password } = c.req.valid("json");

    const retryAfter = rateLimiter.retryAfterSeconds(email);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "too many login attempts" }, 429);
    }

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !(await checkPassword(password, user.passwordHash))) {
      rateLimiter.recordFailure(email);
      return c.json({ error: "invalid email or password" }, 401);
    }

    rateLimiter.clear(email);
    const token = await signToken(user.id, user.role);
    return c.json({ token }, 200);
  });

  app.use("/api/*", requireAuth());
  app.use("/api/admin/*", requireRole("admin"));

  const adminUsersRoute = createRoute({
    method: "get",
    path: "/api/admin/users",
    security: [{ Bearer: [] }],
    responses: {
      200: {
        content: { "application/json": { schema: AdminUsersSchema } },
        description: "All users (admin only)",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      403: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Forbidden",
      },
    },
  });
  app.openapi(adminUsersRoute, async (c) => {
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users);
    return c.json({ users: allUsers }, 200);
  });

  const ownActive = (id: number, userId: number) =>
    and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt));

  const summaryRoute = createRoute({
    method: "get",
    path: "/api/me/summary",
    security: [{ Bearer: [] }],
    responses: {
      200: {
        content: { "application/json": { schema: SummarySchema } },
        description: "Task counts per status",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  });
  app.openapi(summaryRoute, async (c) => {
    const userId = c.get("userId");
    const rows = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .select({ status: tasks.status, n: count() })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt)))
        .groupBy(tasks.status)
    );

    const summary: Record<"todo" | "in-progress" | "done", number> = {
      todo: 0,
      "in-progress": 0,
      done: 0,
    };
    for (const row of rows) {
      summary[row.status] = row.n;
    }
    return c.json(summary, 200);
  });

  const listTasksRoute = createRoute({
    method: "get",
    path: "/api/tasks",
    security: [{ Bearer: [] }],
    request: {
      query: TaskQuerySchema,
    },
    responses: {
      200: {
        content: { "application/json": { schema: TaskListSchema } },
        description: "Paginated tasks",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Invalid query parameters",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  });
  app.openapi(listTasksRoute, async (c) => {
    const { page, limit, status } = c.req.valid("query");
    const userId = c.get("userId");
    const condition = status
      ? and(eq(tasks.userId, userId), eq(tasks.status, status), isNull(tasks.deletedAt))
      : and(eq(tasks.userId, userId), isNull(tasks.deletedAt));

    const result = await activePool.use(async ({ db: pooledDb }) => {
      const items = await pooledDb
        .select()
        .from(tasks)
        .where(condition)
        .limit(limit)
        .offset((page - 1) * limit);

      const [row] = await pooledDb
        .select({ total: count() })
        .from(tasks)
        .where(condition);
      return { items, total: row?.total ?? 0 };
    });

    return c.json({ items: result.items, page, limit, total: result.total }, 200);
  });

  const createTaskRoute = createRoute({
    method: "post",
    path: "/api/tasks",
    security: [{ Bearer: [] }],
    request: {
      body: {
        content: { "application/json": { schema: TaskBodySchema } },
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: TaskSchema } },
        description: "Task created",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Validation failed",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
    },
  });
  app.openapi(createTaskRoute, async (c) => {
    const data = c.req.valid("json");
    const userId = c.get("userId");
    const [created] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .insert(tasks)
        .values({ ...data, userId })
        .returning()
    );

    wsHub.broadcast(userId, { type: "task.created", task: created });
    return c.json(created, 201);
  });

  const getTaskRoute = createRoute({
    method: "get",
    path: "/api/tasks/{id}",
    security: [{ Bearer: [] }],
    request: { params: IdParamSchema },
    responses: {
      200: {
        content: { "application/json": { schema: TaskSchema } },
        description: "Task found",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Task not found",
      },
    },
  });
  app.openapi(getTaskRoute, async (c) => {
    const id = parseId(c.req.valid("param").id);
    if (id === null) return c.json({ error: "not found" }, 404);

    const userId = c.get("userId");
    if (kv) {
      const hit = await kv.get<typeof tasks.$inferSelect>(["task", userId, id]);
      if (hit.value) return c.json(hit.value, 200);
    }

    const [task] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .select()
        .from(tasks)
        .where(ownActive(id, userId))
    );
    if (!task) return c.json({ error: "not found" }, 404);

    if (kv) {
      await kv.set(["task", userId, id], task, { expireIn: TASK_CACHE_TTL_MS });
    }
    return c.json(task, 200);
  });

  const updateTaskRoute = createRoute({
    method: "put",
    path: "/api/tasks/{id}",
    security: [{ Bearer: [] }],
    request: {
      params: IdParamSchema,
      body: {
        content: { "application/json": { schema: TaskBodySchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: TaskSchema } },
        description: "Task updated",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Validation failed",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Task not found",
      },
    },
  });
  app.openapi(updateTaskRoute, async (c) => {
    const id = parseId(c.req.valid("param").id);
    if (id === null) return c.json({ error: "not found" }, 404);

    const userId = c.get("userId");
    const data = c.req.valid("json");
    const [updated] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .update(tasks)
        .set(data)
        .where(ownActive(id, userId))
        .returning()
    );
    if (!updated) return c.json({ error: "not found" }, 404);

    if (kv) await kv.delete(["task", userId, id]);
    wsHub.broadcast(userId, { type: "task.updated", task: updated });
    return c.json(updated, 200);
  });

  const deleteTaskRoute = createRoute({
    method: "delete",
    path: "/api/tasks/{id}",
    security: [{ Bearer: [] }],
    request: { params: IdParamSchema },
    responses: {
      200: {
        content: { "application/json": { schema: OkSchema } },
        description: "Task soft-deleted",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Task not found",
      },
    },
  });
  app.openapi(deleteTaskRoute, async (c) => {
    const id = parseId(c.req.valid("param").id);
    if (id === null) return c.json({ error: "not found" }, 404);

    const userId = c.get("userId");
    const now = Math.floor(Date.now() / 1000);
    const [deleted] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .update(tasks)
        .set({ deletedAt: now })
        .where(ownActive(id, userId))
        .returning({ id: tasks.id })
    );
    if (!deleted) return c.json({ error: "not found" }, 404);

    if (kv) await kv.delete(["task", userId, id]);
    wsHub.broadcast(userId, { type: "task.deleted", task: deleted });
    return c.json({ ok: true }, 200);
  });

  const restoreTaskRoute = createRoute({
    method: "post",
    path: "/api/tasks/{id}/restore",
    security: [{ Bearer: [] }],
    request: { params: IdParamSchema },
    responses: {
      200: {
        content: { "application/json": { schema: TaskSchema } },
        description: "Task restored",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Deleted task not found",
      },
    },
  });
  app.openapi(restoreTaskRoute, async (c) => {
    const id = parseId(c.req.valid("param").id);
    if (id === null) return c.json({ error: "not found" }, 404);

    const userId = c.get("userId");
    const [restored] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .update(tasks)
        .set({ deletedAt: null })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.userId, userId),
            isNotNull(tasks.deletedAt),
          ),
        )
        .returning()
    );
    if (!restored) return c.json({ error: "not found" }, 404);

    if (kv) await kv.delete(["task", userId, id]);
    wsHub.broadcast(userId, { type: "task.restored", task: restored });
    return c.json(restored, 200);
  });

  const uploadAttachmentRoute = createRoute({
    method: "post",
    path: "/api/tasks/{id}/attachment",
    security: [{ Bearer: [] }],
    request: { params: IdParamSchema },
    responses: {
      200: {
        content: { "application/json": { schema: TaskSchema } },
        description: "Attachment uploaded",
      },
      400: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "File required",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Task not found",
      },
      413: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "File too large",
      },
      415: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unsupported media type",
      },
    },
  });
  app.openapi(uploadAttachmentRoute, async (c) => {
    const id = parseId(c.req.valid("param").id);
    if (id === null) return c.json({ error: "not found" }, 404);

    const userId = c.get("userId");
    const [task] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .select()
        .from(tasks)
        .where(ownActive(id, userId))
    );
    if (!task) return c.json({ error: "not found" }, 404);

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "file required" }, 400);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return c.json({ error: "too large" }, 413);
    }
    const ext = ALLOWED_IMAGE_TYPES[file.type];
    if (!ext) {
      return c.json({ error: "type not allowed" }, 415);
    }

    const storedName = `${crypto.randomUUID()}.${ext}`;
    await Deno.mkdir(uploadsDir, { recursive: true });
    const bytes = new Uint8Array(await file.arrayBuffer());
    await Deno.writeFile(`${uploadsDir}/${storedName}`, bytes);

    const [updated] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .update(tasks)
        .set({ attachment: storedName })
        .where(ownActive(id, userId))
        .returning()
    );

    if (kv) await kv.delete(["task", userId, id]);
    return c.json(updated, 200);
  });

  const downloadAttachmentRoute = createRoute({
    method: "get",
    path: "/api/tasks/{id}/attachment",
    security: [{ Bearer: [] }],
    request: { params: IdParamSchema },
    responses: {
      200: {
        description: "Attachment image bytes",
      },
      401: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Unauthorized",
      },
      404: {
        content: { "application/json": { schema: ErrorSchema } },
        description: "Attachment not found",
      },
    },
  });
  app.openapi(downloadAttachmentRoute, async (c) => {
    const id = parseId(c.req.valid("param").id);
    if (id === null) return c.json({ error: "not found" }, 404);

    const [task] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .select()
        .from(tasks)
        .where(ownActive(id, c.get("userId")))
    );
    if (!task || !task.attachment) return c.json({ error: "not found" }, 404);

    const bytes = await Deno.readFile(`${uploadsDir}/${task.attachment}`);
    return c.body(bytes, 200, {
      "content-type": contentTypeFromFilename(task.attachment),
    });
  });

  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: { title: "Tasks API", version: "1.0.0" },
  });

  app.get("/docs", (c) => c.html(SWAGGER_HTML));

  app.notFound((c) => c.json({ error: "not found", requestId: c.get("requestId") }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error", requestId: c.get("requestId") }, 500);
  });

  return app;
}
