import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getMigrations } from "better-auth/db/migration";
import type { Database } from "bun:sqlite";
import * as authSchema from "./db/schema.ts";
import { sendEmail } from "./email.ts";
import { renderLinkEmail } from "./emails/link-email.tsx";
import { env } from "./env.ts";

export type AuthDatabase = Database | unknown;

export type AuthInstance = ReturnType<typeof betterAuth>;

async function deliverAuthEmail(
  email: Parameters<typeof sendEmail>[0],
): Promise<void> {
  try {
    await sendEmail(email);
  } catch {}
}

export type CreateAuthInstanceOptions = {
  database?: AuthDatabase;
  drizzleDatabase?: unknown;
  baseURL?: string;
  webBaseURL?: string;
  secret?: string;
  requireEmailVerification?: boolean;
  sendVerificationEmail?: (input: { email: string; url: string }) => Promise<void>;
};

export function createAuthInstance(
  options: CreateAuthInstanceOptions = {},
): AuthInstance {
  const baseURL = options.baseURL ?? env.BETTER_AUTH_URL;
  const webBaseURL = options.webBaseURL ?? env.TAB_WEB_BASE_URL;
  const secret = options.secret ?? env.BETTER_AUTH_SECRET;
  const requireEmailVerification = options.requireEmailVerification ?? false;

  const authOptions: BetterAuthOptions = {
    secret,
    baseURL,
    basePath: "/api/auth",
    trustedOrigins: [webBaseURL],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await deliverAuthEmail({
          to: user.email,
          subject: "Reset your Tab password",
          text: `Reset your Tab password: ${url}`,
          html: await renderLinkEmail({
            message: "Use this link to reset your Tab password.",
            preview: "Reset your Tab password",
            url,
          }),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const verificationUrl = new URL("/verify-email/confirm", webBaseURL);
        verificationUrl.search = new URL(url).search;
        if (options.sendVerificationEmail) {
          await options.sendVerificationEmail({ email: user.email, url: verificationUrl.toString() });
          return;
        }
        await deliverAuthEmail({
          to: user.email,
          subject: "Verify your Tab email",
          text: `Verify your Tab email address: ${verificationUrl}`,
          html: await renderLinkEmail({
            message: "Use this link to verify your Tab email address.",
            preview: "Verify your Tab email address",
            url: verificationUrl.toString(),
          }),
        });
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
    },
    logger: {
      disabled: true,
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
