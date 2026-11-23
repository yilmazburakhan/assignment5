// Burakhan Yılmaz, 2200005240
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "file:./tasks.db" },
});
