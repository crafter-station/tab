import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { Database } from "bun:sqlite";

export type AuthDatabase = Database | unknown;

export type AuthInstance = ReturnType<typeof betterAuth>;

export type CreateAuthInstanceOptions = {
  database?: AuthDatabase;
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

  if (options.database) {
    authOptions.database = options.database as BetterAuthOptions["database"];
  }

  return betterAuth(authOptions);
}

export async function migrateAuth(auth: AuthInstance): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
