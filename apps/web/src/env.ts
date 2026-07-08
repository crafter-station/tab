import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().default(3000),
    TAB_API_BASE_URL: z.url().default("http://localhost:8787"),
    TAB_DESKTOP_LATEST_VERSION: z.string().default("0.1.0"),
    TAB_MAC_DOWNLOAD_URL: z.url().default("https://downloads.tab.app/tab.dmg"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
