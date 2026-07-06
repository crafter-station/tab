import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import path from "node:path";

export default defineConfig({
  renderer: {
    root: path.resolve(__dirname, "src/renderer"),
    plugins: [react()],
    build: {
      outDir: path.resolve(__dirname, "dist/renderer"),
      emptyOutDir: true,
    },
  },
});
