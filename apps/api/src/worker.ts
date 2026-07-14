import { createDatabase, type AppDatabase } from "./db/index.ts";
import handler from "./index.ts";
import { D1MemoryExtractionStorage } from "./personal-memory-extraction.ts";

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
    await cleanupExpiredMemoryExtractionRecords(
      createDatabase(env.DB),
      new Date(controller.scheduledTime),
    );
  },
} satisfies ExportedHandler<Env>;
