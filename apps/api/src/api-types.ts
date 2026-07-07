import type { D1Database } from "@cloudflare/workers-types";
import type { Hono } from "hono";
import type { Device } from "./device-tokens.ts";

export type ApiVariables = {
  device: Device;
};

export type ApiBindings = {
  DB?: D1Database;
};

export type ApiApp = Hono<{ Bindings: ApiBindings; Variables: ApiVariables }>;
