// Burakhan Yılmaz, 2200005240
import { count, eq } from "drizzle-orm";
import { hashPassword } from "../src/auth.ts";
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";

if (Deno.env.get("APP_ENV") === "production") {
  console.error("Refusing to run seed script in production.");
  Deno.exit(1);
}

const dbUrl = Deno.env.get("DATABASE_URL") ?? "file:./tasks.db";
const dbConn = createDb(dbUrl);
await migrate(dbConn);

const demoPasswordHash = await hashPassword("demo1234");
const adminPasswordHash = await hashPassword("admin1234");

await dbConn.db
  .insert(users)
  .values([
    { email: "demo@example.com", passwordHash: demoPasswordHash, role: "user" },
    { email: "admin@example.com", passwordHash: adminPasswordHash, role: "admin" },
  ])
  .onConflictDoNothing();

const seededUsers = await dbConn.db
  .select()
  .from(users)
  .where(eq(users.email, "demo@example.com"));
const adminUsers = await dbConn.db
  .select()
  .from(users)
  .where(eq(users.email, "admin@example.com"));

const statuses = ["todo", "in-progress", "done"] as const;
const priorities = ["low", "medium", "high"] as const;

let insertedTasks = 0;

for (const user of [...seededUsers, ...adminUsers]) {
  const [existing] = await dbConn.db
    .select({ total: count() })
    .from(tasks)
    .where(eq(tasks.userId, user.id));

  if ((existing?.total ?? 0) === 0) {
    const batch = Array.from({ length: 10 }, (_, i) => ({
      userId: user.id,
      title: `${user.role === "admin" ? "Admin" : "Demo"} Task ${i + 1}`,
      status: statuses[i % statuses.length],
      priority: priorities[i % priorities.length],
    }));
    await dbConn.db.insert(tasks).values(batch);
    insertedTasks += batch.length;
  }
}

console.log(`Seed complete. Users ensured: 2, new tasks inserted: ${insertedTasks}`);
dbConn.client.close();
