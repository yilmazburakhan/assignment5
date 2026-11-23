// Burakhan Yılmaz, 2200005240
import { createApp } from "./app.ts";
import { createDb, migrate } from "./db.ts";

const db = createDb(Deno.env.get("DATABASE_URL") ?? "file:./tasks.db");
await migrate(db);

const port = Number(Deno.env.get("PORT") ?? 8000);
Deno.serve({ port }, createApp(db).fetch);
