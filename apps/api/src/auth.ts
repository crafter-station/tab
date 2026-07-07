import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getMigrations } from "better-auth/db/migration";
import type { Database } from "bun:sqlite";
import * as authSchema from "./db/schema.ts";
import { linkEmailHtml, sendEmail } from "./email.ts";
import { env } from "./env.ts";

export type AuthDatabase = Database | unknown;

export type AuthInstance = ReturnType<typeof betterAuth>;

function deliverAuthEmail(email: Parameters<typeof sendEmail>[0]): void {
  void sendEmail(email).catch((error) => {
    console.error("Failed to send auth email", error);
  });
}

export type CreateAuthInstanceOptions = {
  database?: AuthDatabase;
  drizzleDatabase?: unknown;
  baseURL?: string;
  secret?: string;
  requireEmailVerification?: boolean;
};

export function createAuthInstance(
  options: CreateAuthInstanceOptions = {},
): AuthInstance {
  const baseURL = options.baseURL ?? env.BETTER_AUTH_URL;
  const secret = options.secret ?? env.BETTER_AUTH_SECRET;
  const requireEmailVerification = options.requireEmailVerification ?? false;

  const authOptions: BetterAuthOptions = {
    secret,
    baseURL,
    basePath: "/api/auth",
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        deliverAuthEmail({
          to: user.email,
          subject: "Reset your Tabb password",
          text: `Reset your Tabb password: ${url}`,
          html: linkEmailHtml("Use this link to reset your Tabb password.", url),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        deliverAuthEmail({
          to: user.email,
          subject: "Verify your Tabb email",
          text: `Verify your Tabb email address: ${url}`,
          html: linkEmailHtml("Use this link to verify your Tabb email address.", url),
        });
      },
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
