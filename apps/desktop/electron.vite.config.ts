import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import path from "node:path";

export default defineConfig({
  renderer: {
    root: path.resolve(__dirname, "src/renderer"),
    plugins: [tailwindcss() as never, react()],
    build: {
      outDir: path.resolve(__dirname, "dist/renderer"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          app: path.resolve(__dirname, "src/renderer/app.html"),
          overlay: path.resolve(__dirname, "src/renderer/overlay.html"),
        },
      },
    },
  },
});
