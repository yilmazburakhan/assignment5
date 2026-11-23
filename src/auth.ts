// Burakhan Yılmaz, 2200005240
import bcrypt from "bcryptjs";
import type { MiddlewareHandler } from "hono";
import { jwtVerify, SignJWT } from "jose";

export type Role = "user" | "admin";

export type Env = {
  Variables: {
    userId: number;
    role: Role;
    requestId: string;
  };
};

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

const encodeSecret = (secret?: string) =>
  new TextEncoder().encode(secret ?? Deno.env.get("JWT_SECRET") ?? "dev-secret");

export function signToken(
  userId: number,
  role: Role = "user",
  options?: { secret?: string; expiresIn?: string },
): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setExpirationTime(options?.expiresIn ?? "1h")
    .sign(encodeSecret(options?.secret));
}

export async function verifyToken(
  token: string,
  secretOverride?: string,
): Promise<{ userId: number; role: Role } | null> {
  try {
    const { payload } = await jwtVerify(token, encodeSecret(secretOverride));
    const userId = Number(payload.sub);
    const role = payload.role === "admin" ? "admin" : "user";
    if (!Number.isInteger(userId) || userId <= 0) return null;
    return { userId, role };
  } catch {
    return null;
  }
}

export const requireAuth = (): MiddlewareHandler<Env> => async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const verified = await verifyToken(token);
  if (verified === null) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", verified.userId);
  c.set("role", verified.role);
  await next();
};

export const requireRole =
  (...roles: Role[]): MiddlewareHandler<Env> => async (c, next) => {
    const role = c.get("role");
    if (!role) return c.json({ error: "unauthenticated" }, 401);
    if (!roles.includes(role)) return c.json({ error: "forbidden" }, 403);
    await next();
  };
