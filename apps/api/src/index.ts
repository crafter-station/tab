import { Hono } from "hono";
import { ApiSuccessResponseSchema, SuggestionRequestSchema } from "@tab/contracts";
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
  createBillingProvisioningClient,
} from "./billing.ts";
import {
  CloudflareVectorizePersonalMemoryIndex,
  D1PersonalMemoryStorage,
  PersonalMemoryService,
  WorkersAiPersonalMemoryEmbeddingService,
  type PersonalMemoryEmbeddingService,
  type PersonalMemoryStorage,
  type PersonalMemoryVectorIndex,
} from "./personal-memory.ts";
import {
  D1MemoryExtractionStorage,
  InMemoryMemoryExtractionStorage,
  MemoryExtractionService,
  createAiGatewayMemoryAgentModel,
  type MemoryAgentModel,
  type MemoryExtractionStorage,
} from "./personal-memory-extraction.ts";
import {
  D1TelemetryStorage,
  TelemetryService,
  type TelemetryStorage,
} from "./telemetry.ts";
import {
  SuggestionUseCase,
  MAX_SUGGESTION_LENGTH,
  createSuggestionPrompt,
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
import { registerUsageRoutes } from "./routes/usage.ts";

export { MAX_SUGGESTION_LENGTH, createSuggestionPrompt, normalizeGeneratedSuggestion };
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
  readonly db?: D1Database;
  readonly generateSuggestion?: SuggestionGenerator;
  readonly auth?: AuthInstance;
  readonly deviceTokenService?: DeviceTokenService;
  readonly billingService?: BillingService;
  readonly billingCheckoutClient?: BillingCheckoutClient;
  readonly personalMemoryStorage?: PersonalMemoryStorage;
  readonly embeddingService?: PersonalMemoryEmbeddingService;
  readonly vectorIndex?: PersonalMemoryVectorIndex;
  readonly memoryExtractionModel?: MemoryAgentModel;
  readonly memoryExtractionStorage?: MemoryExtractionStorage;
  readonly telemetryService?: TelemetryService;
  readonly telemetryStorage?: TelemetryStorage;
};

export function createApp(deps: ApiDependencies = {}) {
  const d1Deps: Partial<
    Pick<
      ApiDependencies,
      | "auth"
      | "deviceTokenService"
      | "billingService"
      | "personalMemoryStorage"
      | "memoryExtractionStorage"
      | "telemetryStorage"
    >
  > = deps.db ? createD1Dependencies(deps.db) : {};

  const generateSuggestion = deps.generateSuggestion ?? createRealSuggestionGenerator();
  const auth = deps.auth ?? d1Deps.auth ?? createAuthInstance();
  const deviceTokenService = deps.deviceTokenService ?? d1Deps.deviceTokenService;
  const billingService = deps.billingService ?? d1Deps.billingService;
  const billingCheckoutClient = deps.billingCheckoutClient ?? createBillingCheckoutClient();
  const personalMemoryStorage = deps.personalMemoryStorage ?? d1Deps.personalMemoryStorage;
  const telemetryStorage = deps.telemetryStorage ?? d1Deps.telemetryStorage;

  if (!deviceTokenService) {
    throw new Error("createApp requires either a D1 database or a deviceTokenService");
  }
  if (!billingService) {
    throw new Error("createApp requires either a D1 database or a billingService");
  }
  if (!personalMemoryStorage) {
    throw new Error("createApp requires either a D1 database or a personalMemoryStorage");
  }
  if (!deps.telemetryService && !telemetryStorage) {
    throw new Error("createApp requires either a D1 database, a telemetryService, or a telemetryStorage");
  }

  const personalMemoryService = new PersonalMemoryService({
    storage: personalMemoryStorage,
    embeddingService: deps.embeddingService,
    vectorIndex: deps.vectorIndex,
  });
  const memoryExtractionStorage =
    deps.memoryExtractionStorage ??
    d1Deps.memoryExtractionStorage ??
    new InMemoryMemoryExtractionStorage((input) =>
      personalMemoryService.commitExtractionOperationAtomically(input),
    );
  const memoryExtractionService = new MemoryExtractionService({
    personalMemoryService,
    storage: memoryExtractionStorage,
    model: deps.memoryExtractionModel,
  });
  const telemetryService =
    deps.telemetryService ?? new TelemetryService({ storage: telemetryStorage! });
  const suggestionUseCase = new SuggestionUseCase({
    billingService,
    personalMemoryService,
    telemetryService,
    generateSuggestion,
  });

  const app = new Hono<{ Bindings: ApiBindings; Variables: ApiVariables }>();
  const authenticateDevice = createDeviceAuthenticator(deviceTokenService);

  registerDeviceAuthRoutes(app, { auth, billingService, deviceTokenService });
  app.on(["POST", "GET"], "/api/auth/*", async (c) => {
    const response = await auth.handler(c.req.raw);
    if (c.req.path.endsWith("/sign-up/email") && response.ok) {
      try {
        const payload = await response.clone().json() as { user?: { id?: string } };
        if (payload.user?.id) await billingService.initializeAccount(payload.user.id);
      } catch {
        // Better Auth owns the response; lazy initialization repairs any parse failure.
      }
    }
    return response;
  });

  app.use("/api/status", authenticateDevice);
  app.use("/api/memory/*", authenticateDevice);
  app.use("/suggestions", authenticateDevice);
  app.use("/telemetry/events", authenticateDevice);
  app.use("/api/usage/*", authenticateDevice);

  registerStatusRoutes(app, {
    billingService,
    telemetryService,
    deviceTokenService,
  });
  registerMemoryRoutes(app, {
    auth,
    personalMemoryService,
    memoryExtractionService,
    telemetryService,
    billingService,
  });
  registerBillingRoutes(app, {
    auth,
    billingService,
    billingCheckoutClient,
    deviceTokenService,
  });
  registerSuggestionRoutes(app, { suggestionUseCase });
  registerTelemetryRoutes(app, { telemetryService, auth });
  registerUsageRoutes(app, { billingService });

  return app;
}

function createD1Dependencies(db: D1Database): Required<
  Pick<
    ApiDependencies,
    | "auth"
    | "deviceTokenService"
    | "billingService"
    | "personalMemoryStorage"
    | "memoryExtractionStorage"
    | "telemetryStorage"
  >
> {
  const database = createDatabase(db);
  const deviceTokenStorage = new D1DeviceTokenStorage(database);
  const billingStorage = new D1BillingStorage(database);
  const personalMemoryStorage = new D1PersonalMemoryStorage(database);
  const memoryExtractionStorage = new D1MemoryExtractionStorage(database);
  const telemetryStorage = new D1TelemetryStorage(database);

  return {
    auth: createAuthInstance({
      drizzleDatabase: database,
      requireEmailVerification: true,
    }),
    deviceTokenService: new DeviceTokenService({ storage: deviceTokenStorage }),
    billingService: new BillingService({
      storage: billingStorage,
      provisioningClient: createBillingProvisioningClient(),
    }),
    personalMemoryStorage,
    memoryExtractionStorage,
    telemetryStorage,
  };
}

const appsByDatabase = new WeakMap<D1Database, ReturnType<typeof createApp>>();

function getAppForEnv(env: ApiBindings | undefined) {
  if (!env?.DB) {
    throw new Error("D1 database binding is required");
  }

  const existing = appsByDatabase.get(env.DB);
  if (existing) return existing;

  const app = createApp({
    db: env.DB,
    ...(env.AI && {
      embeddingService: new WorkersAiPersonalMemoryEmbeddingService(env.AI),
    }),
    ...(env.MEMORY_VECTORIZE && {
      vectorIndex: new CloudflareVectorizePersonalMemoryIndex(
        env.MEMORY_VECTORIZE,
      ),
    }),
    memoryExtractionModel: createAiGatewayMemoryAgentModel(),
  });
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
