// Burakhan Yılmaz, 2200005240
import { drizzle } from "drizzle-orm/libsql";
import { migrate as drizzleMigrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string, authToken?: string) {
  const client = createClient(authToken ? { url, authToken } : { url });
  const db = drizzle(client, { schema });
  return { db, client };
}

export async function migrate({ db }: Db) {
  await drizzleMigrate(db, { migrationsFolder: "./drizzle" });
}
