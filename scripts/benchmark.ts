// Burakhan Yılmaz, 2200005240
import { createClient } from "@libsql/client";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createDb, migrate } from "../src/db.ts";
import * as schema from "../src/schema.ts";
import { tasks, users } from "../src/schema.ts";

async function runNPlusOneComparison() {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const dbConn = createDb(`file:${file}`);
  await migrate(dbConn);

  const [user] = await dbConn.db
    .insert(users)
    .values({ email: "nplus1@example.com", passwordHash: "hash" })
    .returning();

  await dbConn.db.insert(tasks).values([
    { userId: user.id, title: "Task 1", status: "todo" },
    { userId: user.id, title: "Task 2", status: "todo" },
    { userId: user.id, title: "Task 3", status: "in-progress" },
    { userId: user.id, title: "Task 4", status: "done" },
  ]);

  const loggedSql: string[] = [];
  const loggedDb = drizzle(dbConn.client, {
    schema,
    logger: {
      logQuery(query) {
        loggedSql.push(query);
      },
    },
  });

  const userTasks = await loggedDb.select().from(tasks).where(eq(tasks.userId, user.id));
  const statuses = ["todo", "in-progress", "done"] as const;
  const naiveCounts: Record<string, number> = {};
  for (const st of statuses) {
    const [row] = await loggedDb
      .select({ n: count() })
      .from(tasks)
      .where(and(eq(tasks.userId, user.id), eq(tasks.status, st)));
    naiveCounts[st] = row?.n ?? 0;
  }

  console.log("=== BONUS 3: NAIVE VERSION ===");
  console.log(`Loaded tasks: ${userTasks.length}, Query count: ${loggedSql.length}`);
  for (const q of loggedSql) console.log("SQL:", q);

  loggedSql.length = 0;
  const groupedRows = await loggedDb
    .select({ status: tasks.status, n: count() })
    .from(tasks)
    .where(eq(tasks.userId, user.id))
    .groupBy(tasks.status);

  console.log("\n=== BONUS 3: GROUP BY VERSION ===");
  console.log(`Result: ${JSON.stringify(groupedRows)}, Query count: ${loggedSql.length}`);
  for (const q of loggedSql) console.log("SQL:", q);

  dbConn.client.close();
  await Deno.remove(file).catch(() => {});
}

async function runIndexBenchmark() {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const client = createClient({ url: `file:${file}` });
  const dbConn = { db: drizzle(client, { schema }), client };
  await migrate(dbConn);

  await client.execute("DROP INDEX IF EXISTS idx_tasks_user_status");

  const userValues = Array.from({ length: 20 }, (_, i) => ({
    email: `bench${i + 1}@example.com`,
    passwordHash: "hash",
  }));
  const insertedUsers = await dbConn.db.insert(users).values(userValues).returning();

  const statuses = ["todo", "in-progress", "done"] as const;
  const batchSize = 500;
  for (let start = 0; start < 20_000; start += batchSize) {
    const rows = Array.from({ length: batchSize }, (_, offset) => {
      const idx = start + offset;
      const owner = insertedUsers[idx % insertedUsers.length];
      return {
        userId: owner.id,
        title: `Benchmark Task ${idx + 1}`,
        status: statuses[idx % statuses.length],
      };
    });
    await dbConn.db.insert(tasks).values(rows);
  }

  const targetUserId = insertedUsers[10].id;
  const querySql = "SELECT * FROM tasks WHERE user_id = ? AND status = ?";

  const planBefore = await client.execute({
    sql: `EXPLAIN QUERY PLAN ${querySql}`,
    args: [targetUserId, "done"],
  });
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    await client.execute({ sql: querySql, args: [targetUserId, "done"] });
  }
  const beforeMs = (performance.now() - t0) / 20;

  await client.execute("CREATE INDEX idx_tasks_user_status ON tasks(user_id, status)");

  const planAfter = await client.execute({
    sql: `EXPLAIN QUERY PLAN ${querySql}`,
    args: [targetUserId, "done"],
  });
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) {
    await client.execute({ sql: querySql, args: [targetUserId, "done"] });
  }
  const afterMs = (performance.now() - t1) / 20;

  console.log("\n=== BONUS 4: EXPLAIN & TIMING (20,000 TASKS) ===");
  console.log("Plan BEFORE index:", planBefore.rows.map((r) => r.detail).join(" | "));
  console.log(`Avg time BEFORE index: ${beforeMs.toFixed(3)} ms`);
  console.log("Plan AFTER index:", planAfter.rows.map((r) => r.detail).join(" | "));
  console.log(`Avg time AFTER index: ${afterMs.toFixed(3)} ms`);

  client.close();
  await Deno.remove(file).catch(() => {});
}

await runNPlusOneComparison();
await runIndexBenchmark();
