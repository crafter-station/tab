import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { D1BillingStorage } from "../../apps/api/src/billing.ts";
import { createTestDatabase } from "../test-db.ts";

const [databasePath, readyPath, startPath, month, limitValue] =
  Bun.argv.slice(2);
if (!databasePath || !readyPath || !startPath || !month || !limitValue) {
  throw new Error("Missing quota contention fixture arguments");
}

const database = new Database(databasePath);
database.exec("PRAGMA busy_timeout = 5000");

try {
  const storage = new D1BillingStorage(createTestDatabase(database));
  await Bun.write(readyPath, "ready");
  while (!existsSync(startPath)) {
    await Bun.sleep(1);
  }

  const count = await storage.consumeUsageWithinLimit(
    "user-d1",
    month,
    Number(limitValue),
  );
  console.log(JSON.stringify(count));
} finally {
  database.close();
}
