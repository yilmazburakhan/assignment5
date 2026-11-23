// Burakhan Yılmaz, 2200005240
import { assertEquals, assertRejects } from "@std/assert";
import { eq } from "drizzle-orm";
import { registerUserInTx } from "../src/app.ts";
import { hashPassword } from "../src/auth.ts";
import { createDb, migrate } from "../src/db.ts";
import { Pool } from "../src/pool.ts";
import { users } from "../src/schema.ts";
import { createTaskRequest, freshApp, registerAndLogin } from "./helpers.ts";

Deno.test("soft delete hides task from list and restore brings it back", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "soft@example.com");

  const createRes = await createTaskRequest(app, token, { title: "Removable" });
  const created = await createRes.json();

  const notDeletedRestore = await app.request(`/api/tasks/${created.id}/restore`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(notDeletedRestore.status, 404);

  const delRes = await app.request(`/api/tasks/${created.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(delRes.status, 200);

  const listAfterDel = await app.request("/api/tasks", {
    headers: { authorization: `Bearer ${token}` },
  });
  const listData = await listAfterDel.json();
  const found = listData.items.some((t: { id: number }) => t.id === created.id);
  assertEquals(found, false);

  const restoreRes = await app.request(`/api/tasks/${created.id}/restore`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(restoreRes.status, 200);
  const restored = await restoreRes.json();
  assertEquals(restored.deletedAt, null);

  const listAfterRestore = await app.request("/api/tasks", {
    headers: { authorization: `Bearer ${token}` },
  });
  const restoredData = await listAfterRestore.json();
  assertEquals(
    restoredData.items.some((t: { id: number }) => t.id === created.id),
    true,
  );
});

Deno.test("registration transaction rolls back user when welcome task fails", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const dbConn = createDb(`file:${file}`);
  await migrate(dbConn);

  const hash = await hashPassword("password123");
  await assertRejects(
    () =>
      registerUserInTx(dbConn, "rollback@example.com", hash, () => {
        throw new Error("forced welcome task failure");
      }),
    Error,
    "forced welcome task failure",
  );

  const rows = await dbConn.db
    .select()
    .from(users)
    .where(eq(users.email, "rollback@example.com"));
  assertEquals(rows.length, 0);
});

Deno.test("GET /api/me/summary returns accurate counts per status", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "summary@example.com");

  await createTaskRequest(app, token, { title: "WIP 1", status: "in-progress" });
  await createTaskRequest(app, token, { title: "Done 1", status: "done" });
  await createTaskRequest(app, token, { title: "Done 2", status: "done" });

  const res = await app.request("/api/me/summary", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    todo: 1,
    "in-progress": 1,
    done: 2,
  });
});

Deno.test("Pool<T> limits concurrency to 3 across 20 concurrent jobs", async () => {
  const pool = new Pool([1, 2, 3]);
  let active = 0;
  let maxActive = 0;
  let completed = 0;

  const jobs = Array.from({ length: 20 }, () =>
    pool.use(async () => {
      active++;
      if (active > maxActive) maxActive = active;
      await new Promise((r) => setTimeout(r, 15));
      active--;
      completed++;
    }));

  await Promise.all(jobs);
  assertEquals(maxActive, 3);
  assertEquals(completed, 20);
});
