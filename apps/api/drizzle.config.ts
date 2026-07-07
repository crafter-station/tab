import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./apps/api/src/db/schema.ts",
  out: "./apps/api/drizzle",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_D1_TOKEN ?? "",
  },
  casing: "snake_case",
  strict: true,
});
