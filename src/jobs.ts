// Burakhan Yılmaz, 2200005240
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "./db.ts";
import { tasks } from "./schema.ts";

export async function purgeOldDone(dbConn: Db, days: number): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86_400;
  const removed = await dbConn.db
    .delete(tasks)
    .where(and(eq(tasks.status, "done"), lt(tasks.createdAt, cutoff)))
    .returning({ id: tasks.id });
  return removed.length;
}
