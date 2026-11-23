// Burakhan Yılmaz, 2200005240
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at").notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    status: text("status", { enum: ["todo", "in-progress", "done"] })
      .notNull()
      .default("todo"),
    priority: text("priority", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    dueDate: text("due_date"),
    deletedAt: integer("deleted_at"),
    attachment: text("attachment"),
    createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
  },
  (table) => [index("idx_tasks_user_status").on(table.userId, table.status)],
);
