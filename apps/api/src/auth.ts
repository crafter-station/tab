import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getMigrations } from "better-auth/db/migration";
import type { Database } from "bun:sqlite";
import * as authSchema from "./db/schema.ts";

export type AuthDatabase = Database | unknown;

export type AuthInstance = ReturnType<typeof betterAuth>;

export type CreateAuthInstanceOptions = {
  database?: AuthDatabase;
  drizzleDatabase?: unknown;
  baseURL?: string;
  secret?: string;
};

export function createAuthInstance(
  options: CreateAuthInstanceOptions = {},
): AuthInstance {
  const baseURL =
    options.baseURL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:8787";
  const secret =
    options.secret ??
    process.env.BETTER_AUTH_SECRET ??
    "tabb-local-secret-must-be-at-least-32-characters-long";

  const authOptions: BetterAuthOptions = {
    secret,
    baseURL,
    basePath: "/api/auth",
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    rateLimit: {
      enabled: false,
    },
  };

  if (options.drizzleDatabase) {
    authOptions.database = drizzleAdapter(options.drizzleDatabase, {
      provider: "sqlite",
      schema: authSchema,
    });
  } else if (options.database) {
    authOptions.database = options.database as BetterAuthOptions["database"];
  }

  return betterAuth(authOptions);
}

export async function migrateAuth(auth: AuthInstance): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
