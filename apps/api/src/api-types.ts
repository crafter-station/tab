import type { D1Database } from "@cloudflare/workers-types";
import type { Hono } from "hono";
import type { Device } from "./device-tokens.ts";

export type WorkersAiBinding = {
  run(model: string, input: { text: string | string[] }): Promise<unknown>;
};

export type VectorizeBinding = {
  upsert(
    vectors: Array<{ id: string; values: number[]; metadata?: object }>,
  ): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  query(
    values: number[],
    options: {
      topK: number;
      filter?: object;
      returnMetadata?: boolean;
    },
  ): Promise<unknown>;
};

export type ApiVariables = {
  device: Device;
};

export type ApiBindings = {
  DB?: D1Database;
  AI?: WorkersAiBinding;
  MEMORY_VECTORIZE?: VectorizeBinding;
};

export type ApiApp = Hono<{ Bindings: ApiBindings; Variables: ApiVariables }>;
