// Burakhan Yılmaz, 2200005240
import { Hono } from "hono";
import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
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
} from "./auth.ts";
import { Pool } from "./pool.ts";

const CredentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
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

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

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

export function createApp(dbConn: Db, pool?: Pool<Db>) {
  const { db } = dbConn;
  const activePool = pool ?? new Pool([dbConn]);
  const app = new Hono<Env>();

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

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/readyz", async (c) => {
    try {
      await db.run(sql`SELECT 1`);
      return c.json({ ready: true }, 200);
    } catch {
      return c.json({ ready: false }, 503);
    }
  });

  app.post("/auth/register", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = CredentialsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const { email, password } = parsed.data;
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

  app.post("/auth/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = CredentialsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const { email, password } = parsed.data;
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !(await checkPassword(password, user.passwordHash))) {
      return c.json({ error: "invalid email or password" }, 401);
    }

    const token = await signToken(user.id, user.role);
    return c.json({ token }, 200);
  });

  app.use("/api/*", requireAuth());

  app.get("/api/admin/users", requireRole("admin"), async (c) => {
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

  app.get("/api/me/summary", async (c) => {
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

  app.get("/api/tasks", async (c) => {
    const parsed = TaskQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const { page, limit, status } = parsed.data;
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

      const [row] = await pooledDb.select({ total: count() }).from(tasks).where(
        condition,
      );
      return { items, total: row?.total ?? 0 };
    });

    return c.json({ items: result.items, page, limit, total: result.total }, 200);
  });

  app.post("/api/tasks", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = TaskBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const userId = c.get("userId");
    const [created] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .insert(tasks)
        .values({ ...parsed.data, userId })
        .returning()
    );

    return c.json(created, 201);
  });

  app.get("/api/tasks/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "not found" }, 404);

    const [task] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .select()
        .from(tasks)
        .where(ownActive(id, c.get("userId")))
    );

    return task ? c.json(task, 200) : c.json({ error: "not found" }, 404);
  });

  app.put("/api/tasks/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const parsed = TaskBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const [updated] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .update(tasks)
        .set(parsed.data)
        .where(ownActive(id, c.get("userId")))
        .returning()
    );

    return updated ? c.json(updated, 200) : c.json({ error: "not found" }, 404);
  });

  app.delete("/api/tasks/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "not found" }, 404);

    const now = Math.floor(Date.now() / 1000);
    const [deleted] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .update(tasks)
        .set({ deletedAt: now })
        .where(ownActive(id, c.get("userId")))
        .returning({ id: tasks.id })
    );

    return deleted ? c.json({ ok: true }, 200) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/tasks/:id/restore", async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "not found" }, 404);

    const [restored] = await activePool.use(({ db: pooledDb }) =>
      pooledDb
        .update(tasks)
        .set({ deletedAt: null })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.userId, c.get("userId")),
            isNotNull(tasks.deletedAt),
          ),
        )
        .returning()
    );

    return restored ? c.json(restored, 200) : c.json({ error: "not found" }, 404);
  });

  app.notFound((c) => c.json({ error: "not found", requestId: c.get("requestId") }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error", requestId: c.get("requestId") }, 500);
  });

  return app;
}
