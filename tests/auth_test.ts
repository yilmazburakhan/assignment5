// Burakhan Yılmaz, 2200005240
import { assertEquals, assertExists } from "@std/assert";
import { freshApp } from "./helpers.ts";

Deno.test("register creates user without returning passwordHash", async () => {
  const app = await freshApp();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "burak@example.com", password: "password123" }),
  });

  assertEquals(res.status, 201);
  const body = await res.json();
  assertExists(body.id);
  assertEquals(body.email, "burak@example.com");
  assertEquals(body.passwordHash, undefined);
});

Deno.test("register with duplicate email returns 409", async () => {
  const app = await freshApp();
  const payload = JSON.stringify({ email: "dup@example.com", password: "password123" });

  await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
  });

  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
  });

  assertEquals(res.status, 409);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("register with invalid body returns 400 and issues", async () => {
  const app = await freshApp();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password: "123" }),
  });

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation failed");
  assertEquals(Array.isArray(body.issues), true);
});

Deno.test("login returns token on valid credentials", async () => {
  const app = await freshApp();
  await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "login@example.com", password: "password123" }),
  });

  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "login@example.com", password: "password123" }),
  });

  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.token);
});

Deno.test("login with wrong email and wrong password return the same 401 message", async () => {
  const app = await freshApp();
  await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", password: "password123" }),
  });

  const wrongPass = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", password: "wrongpassword" }),
  });

  const wrongEmail = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody@example.com", password: "password123" }),
  });

  assertEquals(wrongPass.status, 401);
  assertEquals(wrongEmail.status, 401);
  const body1 = await wrongPass.json();
  const body2 = await wrongEmail.json();
  assertEquals(body1.error, body2.error);
});

Deno.test("missing token on protected route returns 401", async () => {
  const app = await freshApp();
  const res = await app.request("/api/tasks");
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "unauthorized");
});
