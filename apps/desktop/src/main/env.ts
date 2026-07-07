import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    TABB_API_BASE_URL: z.url().default("http://localhost:8787"),
    TABB_APP_RENDERER_PATH: z.string().optional(),
    TABB_DEBUG_TYPING_OVERLAY: z.enum(["0", "1"]).optional(),
    TABB_DEVICE_ID: z.string().default("device-unknown"),
    TABB_INPUT_TAP_PATH: z.string().optional(),
    TABB_OVERLAY_RENDERER_PATH: z.string().optional(),
    TABB_PRELOAD_PATH: z.string().optional(),
    TABB_SHOW_SETTINGS_ON_START: z.enum(["0", "1"]).default("0"),
    TABB_TRAY_ICON_PATH: z.string().optional(),
    TABB_WEB_BASE_URL: z.url().default("http://localhost:3000"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
