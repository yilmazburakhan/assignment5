// Burakhan Yılmaz, 2200005240
import { createTaskRequest, freshApp, registerAndLogin } from "./helpers.ts";
import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { createApp } from "../src/app.ts";
import { signToken } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import { createDb, migrate } from "../src/db.ts";

Deno.test("JWT rejects tampered, expired, and wrong-secret tokens with 401", async () => {
  const app = await freshApp();
  const validToken = await registerAndLogin(app, "jwt@example.com");

  const tampered = validToken.slice(0, -1) + (validToken.endsWith("a") ? "b" : "a");
  const tamperedRes = await app.request("/api/tasks", {
    headers: { authorization: `Bearer ${tampered}` },
  });
  assertEquals(tamperedRes.status, 401);

  const expiredToken = await signToken(1, "user", { expiresIn: "-10s" });
  const expiredRes = await app.request("/api/tasks", {
    headers: { authorization: `Bearer ${expiredToken}` },
  });
  assertEquals(expiredRes.status, 401);

  const wrongSecretToken = await signToken(1, "user", { secret: "another-secret" });
  const wrongSecretRes = await app.request("/api/tasks", {
    headers: { authorization: `Bearer ${wrongSecretToken}` },
  });
  assertEquals(wrongSecretRes.status, 401);
});

Deno.test("RBAC admin route returns 401 without token, 403 for user, 200 for admin", async () => {
  const app = await freshApp();

  const noToken = await app.request("/api/admin/users");
  assertEquals(noToken.status, 401);

  const userToken = await registerAndLogin(app, "normal@example.com");
  const userRes = await app.request("/api/admin/users", {
    headers: { authorization: `Bearer ${userToken}` },
  });
  assertEquals(userRes.status, 403);

  Deno.env.set("ADMIN_EMAIL", "boss@example.com");
  try {
    const adminToken = await registerAndLogin(app, "boss@example.com");
    const adminRes = await app.request("/api/admin/users", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assertEquals(adminRes.status, 200);
    const data = await adminRes.json();
    assertEquals(data.users.length, 2);
  } finally {
    Deno.env.delete("ADMIN_EMAIL");
  }
});

Deno.test("every response carries x-request-id and 404 body includes it", async () => {
  const app = await freshApp();
  const res = await app.request("/missing-route");
  const headerId = res.headers.get("x-request-id");
  assertExists(headerId);
  const body = await res.json();
  assertEquals(body.requestId, headerId);
});

Deno.test("healthz and readyz return 200, and readyz returns 503 when DB is closed", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const dbConn = createDb(`file:${file}`);
  await migrate(dbConn);
  const app = createApp(dbConn);

  const healthz = await app.request("/healthz");
  assertEquals(healthz.status, 200);
  assertEquals(await healthz.json(), { ok: true });

  const readyzOk = await app.request("/readyz");
  assertEquals(readyzOk.status, 200);
  assertEquals(await readyzOk.json(), { ready: true });

  dbConn.client.close();
  const readyzFail = await app.request("/readyz");
  assertEquals(readyzFail.status, 503);
  assertEquals(await readyzFail.json(), { ready: false });
});

Deno.test("loadConfig refuses invalid PORT and default dev-secret in production", () => {
  assertThrows(
    () => loadConfig({ PORT: "not-a-number" }),
    Error,
    "Invalid configuration",
  );
  assertThrows(
    () => loadConfig({ APP_ENV: "production", JWT_SECRET: "dev-secret" }),
    Error,
    "JWT_SECRET",
  );
  const validProd = loadConfig({
    APP_ENV: "production",
    PORT: "9000",
    JWT_SECRET: "strong-secret-key",
  });
  assertEquals(validProd.PORT, 9000);
});
Deno.test("OpenAPI serves /openapi.json with routes and Bearer scheme, plus /docs", async () => {
  const app = await freshApp();

  const specRes = await app.request("/openapi.json");
  assertEquals(specRes.status, 200);
  const spec = await specRes.json();
  assertEquals(spec.openapi, "3.0.0");
  assertExists(spec.components.securitySchemes.Bearer);
  assertExists(spec.paths["/auth/register"]);
  assertExists(spec.paths["/auth/login"]);
  assertExists(spec.paths["/api/tasks"]);
  assertExists(spec.paths["/api/tasks/{id}"]);
  assertExists(spec.paths["/api/tasks/{id}/attachment"]);

  const docsRes = await app.request("/docs");
  assertEquals(docsRes.status, 200);
  const html = await docsRes.text();
  assertEquals(html.includes("/openapi.json"), true);
});

Deno.test("attachment upload validates file/size/type (400/413/415) and serves only to owner", async () => {
  const app = await freshApp();
  const tokenA = await registerAndLogin(app, "upload-a@example.com");
  const tokenB = await registerAndLogin(app, "upload-b@example.com");

  const taskRes = await createTaskRequest(app, tokenA, { title: "With image" });
  const task = await taskRes.json();

  const emptyForm = new FormData();
  const missingFile = await app.request(`/api/tasks/${task.id}/attachment`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenA}` },
    body: emptyForm,
  });
  assertEquals(missingFile.status, 400);

  const bigForm = new FormData();
  bigForm.append(
    "file",
    new File([new Uint8Array(1_000_001)], "big.png", { type: "image/png" }),
  );
  const tooLarge = await app.request(`/api/tasks/${task.id}/attachment`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenA}` },
    body: bigForm,
  });
  assertEquals(tooLarge.status, 413);

  const txtForm = new FormData();
  txtForm.append("file", new File(["hello"], "note.txt", { type: "text/plain" }));
  const badType = await app.request(`/api/tasks/${task.id}/attachment`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenA}` },
    body: txtForm,
  });
  assertEquals(badType.status, 415);

  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const goodForm = new FormData();
  goodForm.append("file", new File([pngBytes], "a.png", { type: "image/png" }));
  const uploadOk = await app.request(`/api/tasks/${task.id}/attachment`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenA}` },
    body: goodForm,
  });
  assertEquals(uploadOk.status, 200);
  const updatedTask = await uploadOk.json();
  assertExists(updatedTask.attachment);
  assertEquals(updatedTask.attachment === "a.png", false);

  const downloadOk = await app.request(`/api/tasks/${task.id}/attachment`, {
    headers: { authorization: `Bearer ${tokenA}` },
  });
  assertEquals(downloadOk.status, 200);
  assertEquals(downloadOk.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await downloadOk.arrayBuffer()), pngBytes);

  const downloadOther = await app.request(`/api/tasks/${task.id}/attachment`, {
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assertEquals(downloadOther.status, 404);
});
