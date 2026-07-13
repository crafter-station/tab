import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    AI_GATEWAY_API_KEY: z.string().optional(),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32)
      .default("tab-local-secret-must-be-at-least-32-characters-long"),
    BETTER_AUTH_URL: z.url().default("http://localhost:8787"),
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    CLOUDFLARE_DATABASE_ID: z.string().optional(),
    CLOUDFLARE_D1_TOKEN: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    POLAR_ACCESS_TOKEN: z.string().optional(),
    POLAR_AUTOCOMPLETE_METER_ID: z.string().optional(),
    POLAR_DEEP_COMPLETE_METER_ID: z.string().optional(),
    POLAR_CHECKOUT_SUCCESS_URL: z.url().optional(),
    POLAR_ORGANIZATION_ID: z.string().optional(),
    POLAR_PRODUCT_ID_FREE: z.string().optional(),
    POLAR_PRODUCT_ID_MAX: z.string().optional(),
    POLAR_PRODUCT_ID_PRO: z.string().optional(),
    POLAR_PRODUCT_ID_PRO_ANNUAL: z.string().optional(),
    POLAR_PRODUCT_ID_PRO_MONTHLY: z.string().optional(),
    POLAR_SERVER: z.enum(["production", "sandbox"]).default("production"),
    POLAR_SEND_ORGANIZATION_ID: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    POLAR_WEBHOOK_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    TAB_WEB_BASE_URL: z.url().default("http://localhost:3000"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
