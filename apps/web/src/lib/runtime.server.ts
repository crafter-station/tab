import { env as cloudflareEnv } from "cloudflare:workers";
import { z } from "zod";

const RuntimeConfigSchema = z.object({
  TAB_API_BASE_URL: z.url().default("http://localhost:8787"),
  TAB_MAC_DOWNLOAD_URL: z.url().default("https://downloads.tab.app/tab.dmg"),
  TAB_DESKTOP_LATEST_VERSION: z.string().min(1).default("0.1.0"),
});

export type WebRuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function getRuntimeConfig(overrides: Partial<WebRuntimeConfig> = {}): WebRuntimeConfig {
  const bindings = cloudflareEnv as Partial<WebRuntimeConfig>;
  return RuntimeConfigSchema.parse({
    TAB_API_BASE_URL: overrides.TAB_API_BASE_URL ?? process.env.TAB_API_BASE_URL ?? bindings.TAB_API_BASE_URL,
    TAB_MAC_DOWNLOAD_URL: overrides.TAB_MAC_DOWNLOAD_URL ?? process.env.TAB_MAC_DOWNLOAD_URL ?? bindings.TAB_MAC_DOWNLOAD_URL,
    TAB_DESKTOP_LATEST_VERSION: overrides.TAB_DESKTOP_LATEST_VERSION ?? process.env.TAB_DESKTOP_LATEST_VERSION ?? bindings.TAB_DESKTOP_LATEST_VERSION,
  });
}
