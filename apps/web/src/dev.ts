import { createWebApp } from "./server.ts";
import { env } from "./env.ts";

const port = env.PORT;
const apiBaseUrl = env.TABB_API_BASE_URL;

Bun.serve({
  port,
  fetch: createWebApp({ apiBaseUrl }).fetch,
});

console.log(`Started web development server: http://localhost:${port}`);
