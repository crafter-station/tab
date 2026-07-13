import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./apps/web/src/**/*.{ts,tsx}",
    "./apps/desktop/src/renderer/src/**/*.{ts,tsx}",
    "./packages/ui/src/**/*.{ts,tsx}",
  ],
} satisfies Config;
