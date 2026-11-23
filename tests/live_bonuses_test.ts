// Burakhan Yılmaz, 2200005240
import { assertEquals, assertExists } from "@std/assert";
import { createApp } from "../src/app.ts";
import { createDb, type Db, migrate } from "../src/db.ts";
import { purgeOldDone } from "../src/jobs.ts";
import { Pool } from "../src/pool.ts";
import { tasks, users } from "../src/schema.ts";
import { createTaskRequest, freshApp, registerAndLogin } from "./helpers.ts";

Deno.test("WebSocket rejects missing or invalid token with 401", async () => {
  const app = await freshApp();

  const noToken = await app.request("/ws");
  assertEquals(noToken.status, 401);

  const badToken = await app.request("/ws?token=invalid.jwt.value");
  assertEquals(badToken.status, 401);
});

Deno.test("purgeOldDone removes done tasks older than 30 days and is idempotent", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const dbConn = createDb(`file:${file}`);
  await migrate(dbConn);

  try {
    const [user] = await dbConn.db
      .insert(users)
      .values({ email: "cron@example.com", passwordHash: "hash" })
      .returning();

    const now = Math.floor(Date.now() / 1000);
    const fortyDaysAgo = now - 40 * 86_400;
    const fiveDaysAgo = now - 5 * 86_400;

    await dbConn.db.insert(tasks).values([
      { userId: user.id, title: "Old done", status: "done", createdAt: fortyDaysAgo },
      { userId: user.id, title: "Old todo", status: "todo", createdAt: fortyDaysAgo },
      { userId: user.id, title: "Recent done", status: "done", createdAt: fiveDaysAgo },
    ]);

    const firstRun = await purgeOldDone(dbConn, 30);
    assertEquals(firstRun, 1);

    const secondRun = await purgeOldDone(dbConn, 30);
    assertEquals(secondRun, 0);

    const remaining = await dbConn.db.select().from(tasks);
    assertEquals(remaining.length, 2);
    assertEquals(remaining.some((t) => t.title === "Old done"), false);
  } finally {
    dbConn.client.close();
  }
});

Deno.test("login rate limit returns 429 with Retry-After after 5 failures", async () => {
  const app = await freshApp();
  await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "limit@example.com", password: "password123" }),
  });

  for (let i = 0; i < 5; i++) {
    const failRes = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "limit@example.com", password: "wrongpassword" }),
    });
    assertEquals(failRes.status, 401);
  }

  const blockedRes = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "limit@example.com", password: "password123" }),
  });
  assertEquals(blockedRes.status, 429);
  const retryAfter = Number(blockedRes.headers.get("retry-after"));
  assertEquals(retryAfter >= 1 && retryAfter <= 60, true);
});

Deno.test("Deno KV caches GET /api/tasks/:id, invalidates on update, and isolates users", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const kvFile = await Deno.makeTempFile({ suffix: ".kv" });
  const dbConn = createDb(`file:${file}`);
  await migrate(dbConn);
  const kv = await Deno.openKv(kvFile);

  let poolAcquires = 0;
  class CountingPool extends Pool<Db> {
    override acquire(): Promise<Db> {
      poolAcquires++;
      return super.acquire();
    }
  }

  try {
    const pool = new CountingPool([dbConn]);
    const app = createApp(dbConn, pool, "./uploads", kv);

    const tokenA = await registerAndLogin(app, "cache-a@example.com");
    const tokenB = await registerAndLogin(app, "cache-b@example.com");

    const createRes = await createTaskRequest(app, tokenA, { title: "Cached title" });
    const created = await createRes.json();

    poolAcquires = 0;
    const firstGet = await app.request(`/api/tasks/${created.id}`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assertEquals(firstGet.status, 200);
    assertEquals((await firstGet.json()).title, "Cached title");
    assertEquals(poolAcquires, 1);

    const secondGet = await app.request(`/api/tasks/${created.id}`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assertEquals(secondGet.status, 200);
    assertEquals((await secondGet.json()).title, "Cached title");
    assertEquals(poolAcquires, 1);

    const otherUserGet = await app.request(`/api/tasks/${created.id}`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assertEquals(otherUserGet.status, 404);

    const putRes = await app.request(`/api/tasks/${created.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ title: "Updated title", status: "done", priority: "high" }),
    });
    assertEquals(putRes.status, 200);

    const afterUpdateGet = await app.request(`/api/tasks/${created.id}`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assertEquals(afterUpdateGet.status, 200);
    const updatedTask = await afterUpdateGet.json();
    assertExists(updatedTask.id);
    assertEquals(updatedTask.title, "Updated title");
  } finally {
    kv.close();
    dbConn.client.close();
  }
});
