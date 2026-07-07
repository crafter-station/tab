import type { Config } from "tailwindcss";

export default {
  content: [
    "./apps/web/src/**/*.{ts,tsx}",
    "./apps/desktop/src/renderer/src/**/*.{ts,tsx}",
    "./packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
} satisfies Config;
