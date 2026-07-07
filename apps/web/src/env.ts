import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().default(3000),
    TABB_API_BASE_URL: z.url().default("http://localhost:8787"),
    TABB_DESKTOP_LATEST_VERSION: z.string().default("0.1.0"),
    TABB_MAC_DOWNLOAD_URL: z.url().default("https://downloads.tabb.app/tabb.dmg"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
