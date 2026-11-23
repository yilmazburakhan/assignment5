// Burakhan Yılmaz, 2200005240
import bcrypt from "bcryptjs";
import type { MiddlewareHandler } from "hono";
import type { Db } from "./db.ts";

export type Env = { Variables: { userId: number } };

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

const SESSION_SECONDS = 60 * 60;

export async function createSession(db: Db, userId: number): Promise<string> {
  const token = crypto.randomUUID();
  await db.client.execute({
    sql:
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, strftime('%s','now') + ?)",
    args: [token, userId, SESSION_SECONDS],
  });
  return token;
}

export async function userIdFromToken(db: Db, token: string): Promise<number | null> {
  const res = await db.client.execute({
    sql:
      "SELECT user_id FROM sessions WHERE token = ? AND expires_at > strftime('%s','now')",
    args: [token],
  });
  const id = res.rows[0]?.user_id;
  return id === undefined ? null : Number(id);
}

export const requireAuth = (db: Db): MiddlewareHandler<Env> => async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const id = await userIdFromToken(db, token);
  if (id === null) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", id);
  await next();
};
