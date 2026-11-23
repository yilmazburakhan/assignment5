// Burakhan Yılmaz, 2200005240
import { Hono } from "hono";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db.ts";
import { tasks, users } from "./schema.ts";
import {
  checkPassword,
  createSession,
  type Env,
  hashPassword,
  requireAuth,
} from "./auth.ts";

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

export function createApp(dbConn: Db) {
  const { db } = dbConn;
  const app = new Hono<Env>();

  app.get("/health", (c) => c.json({ ok: true }));

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

    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id, email: users.email });

    return c.json(created, 201);
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

    const token = await createSession(dbConn, user.id);
    return c.json({ token }, 200);
  });

  app.use("/api/*", requireAuth(dbConn));

  const own = (id: number, userId: number) =>
    and(eq(tasks.id, id), eq(tasks.userId, userId));

  app.get("/api/tasks", async (c) => {
    const parsed = TaskQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const { page, limit, status } = parsed.data;
    const userId = c.get("userId");
    const condition = status
      ? and(eq(tasks.userId, userId), eq(tasks.status, status))
      : eq(tasks.userId, userId);

    const items = await db
      .select()
      .from(tasks)
      .where(condition)
      .limit(limit)
      .offset((page - 1) * limit);

    const [row] = await db.select({ total: count() }).from(tasks).where(condition);
    const total = row?.total ?? 0;

    return c.json({ items, page, limit, total }, 200);
  });

  app.post("/api/tasks", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = TaskBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const userId = c.get("userId");
    const [created] = await db
      .insert(tasks)
      .values({ ...parsed.data, userId })
      .returning();

    return c.json(created, 201);
  });

  app.get("/api/tasks/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "not found" }, 404);

    const [task] = await db
      .select()
      .from(tasks)
      .where(own(id, c.get("userId")));

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

    const [updated] = await db
      .update(tasks)
      .set(parsed.data)
      .where(own(id, c.get("userId")))
      .returning();

    return updated ? c.json(updated, 200) : c.json({ error: "not found" }, 404);
  });

  app.delete("/api/tasks/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "not found" }, 404);

    const [deleted] = await db
      .delete(tasks)
      .where(own(id, c.get("userId")))
      .returning({ id: tasks.id });

    return deleted ? c.json({ ok: true }, 200) : c.json({ error: "not found" }, 404);
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
