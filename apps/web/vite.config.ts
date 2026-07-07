import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart(), viteReact()] as PluginOption[],
  server: {
    port: Number(process.env.PORT ?? 3000),
  },
});
