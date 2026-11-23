// Burakhan Yılmaz, 2200005240
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb, migrate } from "./db.ts";
import { createSqlitePool } from "./pool.ts";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await migrate(db);

const pool = config.DATABASE_URL.startsWith("file:")
  ? await createSqlitePool(config.DATABASE_URL, 3)
  : undefined;

Deno.serve({ port: config.PORT }, createApp(db, pool).fetch);
