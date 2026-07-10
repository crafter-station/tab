import type { ExportedHandlerScheduledHandler } from "@cloudflare/workers-types";
import type { ApiBindings } from "./api-types.ts";
import { createDatabase, type AppDatabase } from "./db/index.ts";
import handler from "./index.ts";
import { D1MemoryExtractionIdempotencyStorage } from "./memory-agent.ts";

export async function cleanupExpiredMemoryExtractionRecords(
  db: AppDatabase,
  now = new Date(),
): Promise<void> {
  await new D1MemoryExtractionIdempotencyStorage(db).pruneExpiredRecords(now);
}

const scheduled: ExportedHandlerScheduledHandler<ApiBindings> = async (
  controller,
  env,
) => {
  if (!env.DB) throw new Error("D1 database binding is required");
  await cleanupExpiredMemoryExtractionRecords(
    createDatabase(env.DB),
    new Date(controller.scheduledTime),
  );
};

export default { fetch: handler.fetch, scheduled };
