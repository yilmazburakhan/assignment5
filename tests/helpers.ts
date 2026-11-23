// Burakhan Yılmaz, 2200005240
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";

export async function freshApp() {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);
  return createApp(db);
}

export async function registerAndLogin(
  app: ReturnType<typeof createApp>,
  email: string,
  password = "password123",
): Promise<string> {
  await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  return data.token;
}

export async function createTaskRequest(
  app: ReturnType<typeof createApp>,
  token: string,
  body: Record<string, unknown>,
) {
  return await app.request("/api/tasks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}
