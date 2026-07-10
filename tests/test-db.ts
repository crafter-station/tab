import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "../apps/api/src/db/schema.ts";

export type TestDatabase = ReturnType<typeof createTestDatabase>;

function getRows(rows: unknown[][]): unknown[] {
  // sqlite-proxy maps `get` directly as one row array, not an array of rows.
  return rows[0] ?? (undefined as unknown as unknown[]);
}

export function createTestDatabase(db: Database) {
  return drizzle(
    async (sql, params, method) => {
      if (method === "get") {
        const rows = db.query(sql).values(...params);
        return { rows: getRows(rows) };
      }
      if (method === "all" || method === "values") {
        const rows = db.query(sql).values(...params);
        return { rows };
      }
      db.query(sql).run(...params);
      return { rows: [] };
    },
    async (batch) =>
      db.transaction(() =>
        batch.map(({ sql, params, method }) => {
          if (method === "get") {
            return { rows: getRows(db.query(sql).values(...params)) };
          }
          if (method === "all" || method === "values") {
            return { rows: db.query(sql).values(...params) };
          }
          db.query(sql).run(...params);
          return { rows: [] };
        }),
      )(),
    { schema },
  );
}
