import {
  MemoryDeleteResponseSchema,
  MemoryExtractionRequestSchema,
  MemoryExtractionResponseSchema,
  MemoryListResponseSchema,
  type MemoryExtractionCounts,
  type MemoryExtractionRequest,
  type PersonalMemory,
} from "@tab/contracts";

export type DesktopMemoryClientDependencies = {
  apiBaseUrl: string;
  getAuthorizationHeader(): Promise<string | null>;
  fetch?: typeof globalThis.fetch;
};

export function createDesktopMemoryClient(deps: DesktopMemoryClientDependencies) {
  const http = deps.fetch ?? globalThis.fetch;

  async function listMemories(): Promise<PersonalMemory[]> {
    const authorization = await deps.getAuthorizationHeader();
    if (!authorization) return [];

    try {
      const response = await http(`${deps.apiBaseUrl}/api/memory`, {
        method: "GET",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
        },
      });

      if (!response.ok) return [];

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
    const authorization = await deps.getAuthorizationHeader();
    if (!authorization) return false;

    try {
      const response = await http(`${deps.apiBaseUrl}/api/memory/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
        },
      });

      if (!response.ok) return false;

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

    const authorization = await deps.getAuthorizationHeader();
    if (!authorization) throw new Error("Missing device authorization");

    const response = await http(`${deps.apiBaseUrl}/api/memory/extract`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsedRequest.data),
    });

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
