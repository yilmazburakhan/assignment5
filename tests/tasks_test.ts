// Burakhan Yılmaz, 2200005240
import { assertEquals, assertExists } from "@std/assert";
import { createTaskRequest, freshApp, registerAndLogin } from "./helpers.ts";

Deno.test("CRUD lifecycle for a user's own task", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "owner@example.com");

  const createRes = await createTaskRequest(app, token, {
    title: "Finish Assignment 5",
    priority: "high",
  });
  assertEquals(createRes.status, 201);
  const created = await createRes.json();
  assertEquals(created.title, "Finish Assignment 5");
  assertEquals(created.status, "todo");
  assertEquals(created.priority, "high");
  assertExists(created.createdAt);

  const getRes = await app.request(`/api/tasks/${created.id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(getRes.status, 200);
  const fetched = await getRes.json();
  assertEquals(fetched.id, created.id);

  const putRes = await app.request(`/api/tasks/${created.id}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: "Submit Assignment 5",
      status: "done",
      priority: "low",
    }),
  });
  assertEquals(putRes.status, 200);
  const updated = await putRes.json();
  assertEquals(updated.title, "Submit Assignment 5");
  assertEquals(updated.status, "done");
  assertEquals(updated.priority, "low");

  const delRes = await app.request(`/api/tasks/${created.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(delRes.status, 200);
  assertEquals(await delRes.json(), { ok: true });

  const afterDel = await app.request(`/api/tasks/${created.id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(afterDel.status, 404);
});

Deno.test("another user cannot read, update, or delete someone else's task (404)", async () => {
  const app = await freshApp();
  const tokenA = await registerAndLogin(app, "alice@example.com");
  const tokenB = await registerAndLogin(app, "bob@example.com");

  const createRes = await createTaskRequest(app, tokenA, { title: "Alice private task" });
  const task = await createRes.json();

  const readRes = await app.request(`/api/tasks/${task.id}`, {
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assertEquals(readRes.status, 404);

  const updateRes = await app.request(`/api/tasks/${task.id}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tokenB}`,
    },
    body: JSON.stringify({ title: "Hijacked", status: "done", priority: "high" }),
  });
  assertEquals(updateRes.status, 404);

  const deleteRes = await app.request(`/api/tasks/${task.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assertEquals(deleteRes.status, 404);
});

Deno.test("creating a task with invalid body or invalid status returns 400", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "val@example.com");

  const emptyTitle = await createTaskRequest(app, token, { title: "" });
  assertEquals(emptyTitle.status, 400);
  const body1 = await emptyTitle.json();
  assertEquals(body1.error, "validation failed");

  const badStatus = await createTaskRequest(app, token, {
    title: "Valid title",
    status: "archived",
  });
  assertEquals(badStatus.status, 400);
  const body2 = await badStatus.json();
  assertEquals(body2.error, "validation failed");
});

Deno.test("pagination returns page 2 with correct items and total", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "page@example.com");

  await createTaskRequest(app, token, { title: "Task 1" });
  await createTaskRequest(app, token, { title: "Task 2" });
  await createTaskRequest(app, token, { title: "Task 3" });

  const res = await app.request("/api/tasks?page=2&limit=2", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.page, 2);
  assertEquals(body.limit, 2);
  assertEquals(body.total, 3);
  assertEquals(body.items.length, 1);
  assertEquals(body.items[0].title, "Task 3");
});

Deno.test("filtering by status returns matching tasks and total", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "filter@example.com");

  await createTaskRequest(app, token, { title: "Todo task", status: "todo" });
  await createTaskRequest(app, token, { title: "Done task", status: "done" });

  const res = await app.request("/api/tasks?status=done", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.total, 1);
  assertEquals(body.items.length, 1);
  assertEquals(body.items[0].title, "Done task");
});

Deno.test("invalid query parameters return 400", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "badq@example.com");

  const res = await app.request("/api/tasks?page=abc&limit=500", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation failed");
});

Deno.test("unknown route returns unified 404 error shape", async () => {
  const app = await freshApp();
  const res = await app.request("/does-not-exist");
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not found" });
});
