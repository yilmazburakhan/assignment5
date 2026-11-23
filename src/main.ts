// Burakhan Yılmaz, 2200005240
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb, migrate } from "./db.ts";
import { purgeOldDone } from "./jobs.ts";
import { createSqlitePool } from "./pool.ts";

const config = loadConfig();
const db = createDb(config.DATABASE_URL, config.DATABASE_AUTH_TOKEN);
await migrate(db);

const pool = config.DATABASE_URL.startsWith("file:")
  ? await createSqlitePool(config.DATABASE_URL, 3)
  : undefined;

const kv = await Deno.openKv(config.KV_PATH);

Deno.cron("purge old done tasks", "0 3 * * *", async () => {
  const removed = await purgeOldDone(db, 30);
  console.log(JSON.stringify({ job: "purge", removed }));
});

Deno.serve({ port: config.PORT }, createApp(db, pool, "./uploads", kv).fetch);
