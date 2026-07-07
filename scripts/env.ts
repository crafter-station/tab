import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    API_PORT: z.coerce.number().int().positive().default(8787),
    POLAR_ACCESS_TOKEN: z.string(),
    POLAR_ORGANIZATION_ID: z.string(),
    POLAR_SERVER: z.enum(["production", "sandbox"]).default("production"),
    POLAR_WEBHOOK_URL: z.url().optional(),
    WEB_PORT: z.coerce.number().int().positive().default(3000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
