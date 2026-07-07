import { Hono } from "hono";
import { logger } from "hono/logger";
import { ApiSuccessResponseSchema, SuggestionRequestSchema } from "@tabb/contracts";
import { createAuthInstance, type AuthInstance } from "./auth.ts";
import {
  D1DeviceTokenStorage,
  DeviceTokenService,
} from "./device-tokens.ts";
import {
  BillingService,
  D1BillingStorage,
  type BillingCheckoutClient,
  createBillingCheckoutClient,
  createUsageMeterClient,
  UsageMeterService,
} from "./billing.ts";
import {
  D1PersonalMemoryStorage,
  PersonalMemoryService,
  type PersonalMemoryStorage,
} from "./personal-memory.ts";
import {
  BackgroundMemoryAgent,
  InMemoryMemoryJobQueue,
  type MemoryJobQueue,
} from "./memory-agent.ts";
import {
  D1TelemetryStorage,
  TelemetryService,
  type TelemetryStorage,
} from "./telemetry.ts";
import {
  SuggestionUseCase,
  createRealSuggestionGenerator,
  normalizeGeneratedSuggestion,
  type SuggestionGenerator,
  type SuggestionInput,
} from "./suggestion-use-case.ts";
import { createDatabase } from "./db/index.ts";
import type { D1Database, ExecutionContext } from "@cloudflare/workers-types";
import type { ApiBindings, ApiVariables } from "./api-types.ts";
import { createDeviceAuthenticator } from "./http/auth.ts";
import { registerDeviceAuthRoutes } from "./routes/auth-device.ts";
import { registerStatusRoutes } from "./routes/status.ts";
import { registerMemoryRoutes } from "./routes/memory.ts";
import { registerBillingRoutes } from "./routes/billing.ts";
import { registerSuggestionRoutes } from "./routes/suggestions.ts";
import { registerTelemetryRoutes } from "./routes/telemetry.ts";

export { normalizeGeneratedSuggestion };
export type { SuggestionGenerator, SuggestionInput };

export const apiAppBoundary = {
  runtime: "cloudflare-worker-hono",
  owns: [
    "device authentication",
    "suggestion generation",
    "Personal Memory APIs",
    "billing and quota enforcement",
  ],
} as const;

export type ApiDependencies = {
  readonly generateSuggestion?: SuggestionGenerator;
  readonly auth?: AuthInstance;
  readonly deviceTokenService?: DeviceTokenService;
  readonly billingService?: BillingService;
  readonly usageMeterService?: UsageMeterService;
  readonly billingCheckoutClient?: BillingCheckoutClient;
  readonly personalMemoryStorage?: PersonalMemoryStorage;
  readonly memoryJobQueue?: MemoryJobQueue;
  readonly memoryAgent?: BackgroundMemoryAgent;
  readonly telemetryService?: TelemetryService;
  readonly telemetryStorage?: TelemetryStorage;
};

export function createApp(deps: ApiDependencies = {}) {
  const generateSuggestion = deps.generateSuggestion ?? createRealSuggestionGenerator();
  const auth = deps.auth ?? createAuthInstance();
  const deviceTokenService = deps.deviceTokenService ?? new DeviceTokenService();
  const billingService = deps.billingService ?? new BillingService();
  const usageMeterService = deps.usageMeterService ?? new UsageMeterService();
  const billingCheckoutClient = deps.billingCheckoutClient ?? createBillingCheckoutClient();
  const personalMemoryService = new PersonalMemoryService({
    storage: deps.personalMemoryStorage,
  });
  const memoryJobQueue = deps.memoryJobQueue ?? new InMemoryMemoryJobQueue();
  const memoryAgent =
    deps.memoryAgent ??
    new BackgroundMemoryAgent({
      personalMemoryService,
      model: deps.generateSuggestion ? undefined : BackgroundMemoryAgent.createRealModel(),
    });
  const telemetryService =
    deps.telemetryService ?? new TelemetryService({ storage: deps.telemetryStorage });
  const suggestionUseCase = new SuggestionUseCase({
    billingService,
    usageMeterService,
    personalMemoryService,
    memoryJobQueue,
    telemetryService,
    generateSuggestion,
  });

  if (memoryJobQueue instanceof InMemoryMemoryJobQueue) {
    memoryJobQueue.subscribe(async (job) => memoryAgent.processJob(job));
  }

  const app = new Hono<{ Bindings: ApiBindings; Variables: ApiVariables }>();
  const authenticateDevice = createDeviceAuthenticator(deviceTokenService);

  app.use("*", logger());

  registerDeviceAuthRoutes(app, { auth, deviceTokenService });
  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.use("/api/status", authenticateDevice);
  app.use("/api/memory/*", authenticateDevice);
  app.use("/suggestions", authenticateDevice);
  app.use("/telemetry/events", authenticateDevice);

  registerStatusRoutes(app, { billingService });
  registerMemoryRoutes(app, { auth, personalMemoryService });
  registerBillingRoutes(app, { auth, billingService, billingCheckoutClient });
  registerSuggestionRoutes(app, { suggestionUseCase });
  registerTelemetryRoutes(app, { telemetryService });

  return app;
}

const defaultApp = createApp();

function createD1Dependencies(db: D1Database): ApiDependencies {
  const database = createDatabase(db);
  const deviceTokenStorage = new D1DeviceTokenStorage(db);
  const billingStorage = new D1BillingStorage(db);
  const personalMemoryStorage = new D1PersonalMemoryStorage(db);
  const telemetryStorage = new D1TelemetryStorage(db);

  return {
    auth: createAuthInstance({
      drizzleDatabase: database,
      requireEmailVerification: true,
    }),
    deviceTokenService: new DeviceTokenService({ storage: deviceTokenStorage }),
    billingService: new BillingService({ storage: billingStorage }),
    usageMeterService: new UsageMeterService({ client: createUsageMeterClient() }),
    personalMemoryStorage,
    telemetryStorage,
  };
}

const appsByDatabase = new WeakMap<D1Database, ReturnType<typeof createApp>>();

function getAppForEnv(env: ApiBindings | undefined) {
  if (!env?.DB) return defaultApp;

  const existing = appsByDatabase.get(env.DB);
  if (existing) return existing;

  const app = createApp(createD1Dependencies(env.DB));
  appsByDatabase.set(env.DB, app);
  return app;
}

export default {
  fetch(request: Request, env?: ApiBindings, executionCtx?: ExecutionContext) {
    return getAppForEnv(env).fetch(request, env, executionCtx);
  },
};

// Backwards-compatible helper for callers that only need payload validation.
export function validateSuggestionPayload(payload: unknown) {
  SuggestionRequestSchema.parse(payload);

  return ApiSuccessResponseSchema.parse({
    status: "ok",
    data: {
      suggestions: [],
    },
  });
}
