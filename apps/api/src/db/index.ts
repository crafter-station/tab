import { drizzle } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { D1Database } from "@cloudflare/workers-types";
import * as schema from "./schema.ts";

export type AppDatabase = BaseSQLiteDatabase<"async", unknown, typeof schema>;

export function createDatabase(db: D1Database): AppDatabase {
  return drizzle(db, { schema }) as unknown as AppDatabase;
}

export { schema };
