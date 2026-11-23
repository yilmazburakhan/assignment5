// Burakhan Yılmaz, 2200005240
import { createApp } from "./app.ts";
import { createDb, migrate } from "./db.ts";
import { createSqlitePool } from "./pool.ts";

const dbUrl = Deno.env.get("DATABASE_URL") ?? "file:./tasks.db";
const db = createDb(dbUrl);
await migrate(db);

const pool = dbUrl.startsWith("file:") ? await createSqlitePool(dbUrl, 3) : undefined;
const port = Number(Deno.env.get("PORT") ?? 8000);
Deno.serve({ port }, createApp(db, pool).fetch);
