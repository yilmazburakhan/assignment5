// Burakhan Yılmaz, 2200005240
import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { createApp } from "../src/app.ts";
import { signToken } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import { createDb, migrate } from "../src/db.ts";
import { freshApp, registerAndLogin } from "./helpers.ts";

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
