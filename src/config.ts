// Burakhan Yılmaz, 2200005240
import { z } from "zod";

const ConfigSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8000),
    DATABASE_URL: z.string().min(1).default("file:./tasks.db"),
    DATABASE_AUTH_TOKEN: z.string().optional(),
    KV_PATH: z.string().optional(),
    JWT_SECRET: z.string().min(1).default("dev-secret"),
  })
  .refine(
    (cfg) => !(cfg.APP_ENV === "production" && cfg.JWT_SECRET === "dev-secret"),
    {
      message: "JWT_SECRET cannot use dev-secret in production",
      path: ["JWT_SECRET"],
    },
  );

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }
  return parsed.data;
}
