import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment variables: ${problems}`);
  }
  return parsed.data;
}

// The .env lives at the repository root, but npm runs the scripts from apps/api,
// so both places are tried.
const ENV_FILES = [".env", path.resolve(__dirname, "../../../.env")];

/** Loads the first .env file found (Node 22 has this built in). */
export function loadDotEnv(): void {
  for (const file of ENV_FILES) {
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      // not there: try the next one, or fall back to the real environment
    }
  }
}
