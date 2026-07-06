import { createWebApp } from "./server.ts";

const port = Number(process.env.PORT ?? 3000);
const apiBaseUrl = process.env.TABB_API_BASE_URL ?? "http://localhost:8787";

Bun.serve({
  port,
  fetch: createWebApp({ apiBaseUrl }).fetch,
});

console.log(`Started web development server: http://localhost:${port}`);
