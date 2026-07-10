import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    TAB_API_BASE_URL: z.url().default("http://localhost:8787"),
    TAB_APP_RENDERER_PATH: z.string().optional(),
    TAB_DEBUG_TYPING_OVERLAY: z.enum(["0", "1"]).optional(),
    TAB_DEVICE_ID: z.string().default("device-unknown"),
    TAB_INPUT_TAP_PATH: z.string().optional(),
    TAB_LOCAL_INFERENCE_EXECUTABLE: z.string().optional(),
    TAB_LOCAL_INFERENCE_MODEL_PATH: z.string().optional(),
    TAB_LOCAL_INFERENCE_MODEL_URL: z.url().optional(),
    TAB_LOCAL_INFERENCE_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    TAB_OVERLAY_RENDERER_PATH: z.string().optional(),
    TAB_PRELOAD_PATH: z.string().optional(),
    TAB_SHOW_SETTINGS_ON_START: z.enum(["0", "1"]).default("0"),
    TAB_TRAY_ICON_PATH: z.string().optional(),
    TAB_WEB_BASE_URL: z.url().default("http://localhost:3000"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
