import {
  MemoryDeleteResponseSchema,
  MemoryExtractionRequestSchema,
  MemoryExtractionResponseSchema,
  MemoryListResponseSchema,
  type MemoryExtractionCounts,
  type MemoryExtractionRequest,
  type PersonalMemory,
} from "@tab/contracts";
import type { DeviceApiClient } from "./device-api-client.ts";

export type DesktopMemoryClientDependencies = {
  api: Pick<DeviceApiClient, "requestAuthorized">;
};

export function createDesktopMemoryClient(deps: DesktopMemoryClientDependencies) {
  async function listMemories(): Promise<PersonalMemory[]> {
    try {
      const response = await deps.api.requestAuthorized("/api/memory", {
        method: "GET",
      });

      if (!response?.ok) return [];

      const raw = (await response.json()) as unknown;
      const parsed = MemoryListResponseSchema.safeParse(raw);
      if (!parsed.success) return [];

      return parsed.data.data.memories;
    } catch {
      // Fail silently for transient failures; status UI handles connectivity.
      return [];
    }
  }

  async function deleteMemory(id: string): Promise<boolean> {
    try {
      const response = await deps.api.requestAuthorized(`/api/memory/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      if (!response?.ok) return false;

      const raw = (await response.json()) as unknown;
      const parsed = MemoryDeleteResponseSchema.safeParse(raw);
      if (!parsed.success) return false;

      return parsed.data.data.deleted;
    } catch {
      return false;
    }
  }

  async function extractMemory(request: MemoryExtractionRequest): Promise<MemoryExtractionCounts> {
    const parsedRequest = MemoryExtractionRequestSchema.safeParse(request);
    if (!parsedRequest.success) throw new Error("Invalid memory extraction request");

    const response = await deps.api.requestAuthorized("/api/memory/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsedRequest.data),
    });

    if (!response) throw new Error("Missing device authorization");
    if (!response.ok) throw new Error(`Memory extraction failed with status ${response.status}`);

    const raw = (await response.json()) as unknown;
    const parsedResponse = MemoryExtractionResponseSchema.safeParse(raw);
    if (!parsedResponse.success) throw new Error("Invalid memory extraction response");

    return parsedResponse.data.data.counts;
  }

  return {
    listMemories,
    deleteMemory,
    extractMemory,
  };
}

export type DesktopMemoryClient = ReturnType<typeof createDesktopMemoryClient>;
