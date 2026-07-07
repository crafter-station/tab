import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";
import { env } from "./src/env.ts";

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart(), viteReact()] as PluginOption[],
  server: {
    port: env.PORT,
  },
});
