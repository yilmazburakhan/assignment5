// STUDENT NAME, STUDENT NUMBER
import { Hono } from "hono";
import type { Db } from "./db.ts";

/** Build the whole application around a database, so tests can give it their own. */
export function createApp(_db: Db) {
  const app = new Hono();

  // Worked example: a health check.
  app.get("/health", (c) => c.json({ ok: true }));

  // TODO R3: POST /auth/register and POST /auth/login (validate with Zod, hash the
  //          password; on login call createSession and answer with the token).
  // TODO R4: GET/POST /api/tasks and GET/PUT/DELETE /api/tasks/:id, only for the owner.
  // TODO R5: one error shape for every failure: { "error": "message", "issues": [...] }.

  app.notFound((c) => c.json({ error: "not found" }, 404));
  return app;
}
