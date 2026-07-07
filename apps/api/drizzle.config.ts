import { defineConfig } from "drizzle-kit";
import { env } from "./src/env.ts";

export default defineConfig({
  schema: "./apps/api/src/db/schema.ts",
  out: "./apps/api/drizzle",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: env.CLOUDFLARE_DATABASE_ID ?? "",
    token: env.CLOUDFLARE_D1_TOKEN ?? "",
  },
  casing: "snake_case",
  strict: true,
});
