import { createDatabase, type AppDatabase } from "./db/index.ts";
import handler from "./index.ts";
import { D1MemoryExtractionStorage } from "./personal-memory-extraction.ts";
import {
  createUsageMeterClient,
  createBillingProvisioningClient,
  BillingService,
  D1BillingStorage,
  UsageMeterService,
} from "./billing.ts";

export async function cleanupExpiredMemoryExtractionRecords(
  db: AppDatabase,
  now = new Date(),
): Promise<void> {
  await new D1MemoryExtractionStorage(db).pruneExpiredRecords(now);
}

export default {
  fetch: handler.fetch,
  async scheduled(controller, env) {
    if (!env.DB) throw new Error("D1 database binding is required");
    const now = new Date(controller.scheduledTime);
    const db = createDatabase(env.DB);
    const billingStorage = new D1BillingStorage(db);
    const billingService = new BillingService({
      storage: billingStorage,
      provisioningClient: createBillingProvisioningClient(),
      now: () => now,
    });
    await Promise.all([
      cleanupExpiredMemoryExtractionRecords(db, now),
      new UsageMeterService({ client: createUsageMeterClient() }).drainOutbox(
        billingStorage,
        { now },
      ),
      billingService.backfillAccounts(),
      billingService.reconcileAccounts(),
    ]);
  },
} satisfies ExportedHandler<Env>;
