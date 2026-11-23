// STUDENT NAME, STUDENT NUMBER
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof createDb>;

/** Open a database. Tests pass "file::memory:" or a temporary file. */
export function createDb(url: string) {
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** Create the tables if they do not exist yet. Keep this in sync with schema.ts. */
export async function migrate({ client }: Db) {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       email TEXT NOT NULL UNIQUE,
       password_hash TEXT NOT NULL,
       created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
     )`,
    `CREATE TABLE IF NOT EXISTS sessions (
       token TEXT PRIMARY KEY,
       user_id INTEGER NOT NULL REFERENCES users(id),
       expires_at INTEGER NOT NULL
     )`,
    // TODO R2: add the tasks table (id, user_id -> users.id, title, status,
    // priority, created_at). Status is one of: todo, in-progress, done.
  ]);
}
