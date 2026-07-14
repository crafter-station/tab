import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

export default defineConfig(({ command, isPreview }) => {
  const rawPort = process.env.WEB_PORT ?? "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid web development port: ${rawPort}`);
  }

  const isDevelopment = command === "serve" && !isPreview;
  const apiBaseUrl = process.env.TAB_API_BASE_URL?.trim() || "http://localhost:8787";

  return {
    plugins: [
      cloudflare({
        viteEnvironment: { name: "ssr" },
        config: (config) =>
          isDevelopment
            ? {
                vars: {
                  ...config.vars,
                  TAB_API_BASE_URL: apiBaseUrl,
                },
              }
            : undefined,
      }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ] as PluginOption[],
    server: {
      port,
      strictPort: true,
    },
  };
});
