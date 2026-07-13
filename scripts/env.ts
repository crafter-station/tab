import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    POLAR_ACCESS_TOKEN: z.string(),
    POLAR_AUTOCOMPLETE_METER_ID: z.string().optional(),
    POLAR_DEEP_COMPLETE_METER_ID: z.string().optional(),
    POLAR_CREDITS_BENEFIT_ID_FREE: z.string().optional(),
    POLAR_CREDITS_BENEFIT_ID_MAX: z.string().optional(),
    POLAR_CREDITS_BENEFIT_ID_PRO: z.string().optional(),
    POLAR_CREDITS_BENEFIT_ID_PRO_MONTHLY: z.string().optional(),
    POLAR_ORGANIZATION_ID: z.string(),
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
    POLAR_WEBHOOK_URL: z.url().optional(),
    WEB_PORT: z.coerce.number().int().positive().default(3000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
