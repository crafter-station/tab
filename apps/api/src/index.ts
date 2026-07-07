import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Context, Next } from "hono";
import { planQuotas } from "@tabb/billing";
import {
  ApiErrorResponseSchema,
  ApiSuccessResponseSchema,
  BillingCheckoutResponseSchema,
  BillingPortalResponseSchema,
  BillingQuotaResponseSchema,
  DesktopStatusResponseSchema,
  DeviceAuthorizeResponseSchema,
  DeviceListResponseSchema,
  DeviceTokenExchangeRequestSchema,
  DeviceTokenExchangeResponseSchema,
  MemoryDeleteResponseSchema,
  MemoryListResponseSchema,
  RecordTelemetryEventRequestSchema,
  SuggestionRequestSchema,
  TelemetryEventsResponseSchema,
  type Suggestion,
} from "@tabb/contracts";
import { createAuthInstance, type AuthInstance } from "./auth.ts";
import {
  D1DeviceTokenStorage,
  DeviceTokenService,
  type Device,
} from "./device-tokens.ts";
import {
  BillingService,
  BillingWebhookHandler,
  D1BillingStorage,
  type BillingCheckoutClient,
  createBillingCheckoutClient,
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

type ApiVariables = {
  device: Device;
};

type ApiBindings = {
  DB?: D1Database;
};

const ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "revoked_device",
  "quota_exhausted",
  "rate_limited",
  "provider_failure",
] as const;

function createErrorResponse(
  code: (typeof ERROR_CODES)[number],
  message: string,
  details?: Record<string, unknown>,
) {
  return ApiErrorResponseSchema.parse({
    status: "error",
    error: { code, message, details },
  });
}

function createSuccessResponse(suggestions: Suggestion[]) {
  return ApiSuccessResponseSchema.parse({
    status: "ok",
    data: { suggestions },
  });
}

function formatValidationIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
}

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
  const generateSuggestion =
    deps.generateSuggestion ?? createRealSuggestionGenerator();
  const auth = deps.auth ?? createAuthInstance();
  const deviceTokenService =
    deps.deviceTokenService ?? new DeviceTokenService();
  const billingService = deps.billingService ?? new BillingService();
  const usageMeterService = deps.usageMeterService ?? new UsageMeterService();
  const billingCheckoutClient =
    deps.billingCheckoutClient ?? createBillingCheckoutClient();
  const personalMemoryService = new PersonalMemoryService({
    storage: deps.personalMemoryStorage,
  });
  const memoryJobQueue = deps.memoryJobQueue ?? new InMemoryMemoryJobQueue();
  const memoryAgent =
    deps.memoryAgent ??
    new BackgroundMemoryAgent({
      personalMemoryService,
      model: deps.generateSuggestion
        ? undefined
        : BackgroundMemoryAgent.createRealModel(),
    });
  const telemetryService =
    deps.telemetryService ??
    new TelemetryService({ storage: deps.telemetryStorage });
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

  app.use("*", logger());

  // Device handoff: a signed-in browser requests a short-lived exchange code.
  // These routes are registered before the Better Auth catch-all so Hono
  // matches them first.
  app.post("/api/auth/device/authorize", async (c) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json(
        createErrorResponse("unauthenticated", "Sign in required."),
        401,
      );
    }

    const code = await deviceTokenService.createExchangeCode(session.user.id);

    return c.json(
      DeviceAuthorizeResponseSchema.parse({ code }),
      200,
    );
  });

  // Native app exchanges the code for an opaque, per-installation device token.
  app.post("/api/auth/device/exchange", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        createErrorResponse("invalid_request", "Request body must be valid JSON."),
        400,
      );
    }

    const parseResult = DeviceTokenExchangeRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      return c.json(
        createErrorResponse(
          "invalid_request",
          formatValidationIssues(parseResult.error.issues),
        ),
        400,
      );
    }

    const exchange = await deviceTokenService.consumeExchangeCode(
      parseResult.data.code,
    );
    if (!exchange) {
      return c.json(
        createErrorResponse(
          "invalid_request",
          "Invalid or expired exchange code.",
        ),
        400,
      );
    }

    const { token } = await deviceTokenService.createDeviceToken(
      exchange.userId,
      {
        deviceId: parseResult.data.deviceId,
        platform: parseResult.data.platform,
        appVersion: parseResult.data.appVersion,
      },
    );

    return c.json(
      DeviceTokenExchangeResponseSchema.parse({ token }),
      200,
    );
  });

  // Revoke a device from the account surface.
  app.post("/api/auth/device/revoke", async (c) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json(
        createErrorResponse("unauthenticated", "Sign in required."),
        401,
      );
    }

    let payload: { deviceId?: string } = {};
    try {
      payload = (await c.req.json()) as { deviceId?: string };
    } catch {
      // allow empty body
    }

    if (!payload.deviceId) {
      return c.json(
        createErrorResponse("invalid_request", "deviceId is required."),
        400,
      );
    }

    const revoked = await deviceTokenService.revokeDevice(
      session.user.id,
      payload.deviceId,
    );

    if (!revoked) {
      return c.json(
        createErrorResponse("invalid_request", "Device not found."),
        404,
      );
    }

    return c.json({ ok: true }, 200);
  });

  // Account device list is served by the API, not Better Auth, and must be
  // registered before the Better Auth catch-all so Hono matches it first.
  app.get("/api/auth/devices", async (c) => {
    const sessionCheck = await requireSession(c);
    if (!sessionCheck.ok) return sessionCheck.response;

    const devices = await deviceTokenService.listDevices(
      sessionCheck.session.user.id,
    );

    return c.json(
      DeviceListResponseSchema.parse({
        status: "ok",
        data: {
          devices: devices.map((device) => ({
            ...deviceTokenService.getDeviceMetadata(device),
            id: device.id,
            deviceId: device.deviceId,
          })),
        },
      }),
      200,
    );
  });

  // Better Auth owns users, sessions, and password/credential flows.
  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // Product APIs require a valid, non-revoked device token.
  async function authenticateDevice(c: Context<{ Variables: ApiVariables }>, next: Next) {
    const authorization = c.req.header("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return c.json(
        createErrorResponse("unauthenticated", "Device token required."),
        401,
      );
    }

    const token = authorization.slice("Bearer ".length);
    const device = await deviceTokenService.verifyDeviceToken(token);

    if (!device) {
      return c.json(
        createErrorResponse("unauthenticated", "Invalid device token."),
        401,
      );
    }

    if (device.revoked) {
      return c.json(
        createErrorResponse("revoked_device", "This device has been revoked."),
        401,
      );
    }

    c.set("device", device);
    await next();
  }

  async function requireSession(c: Context) {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return {
        ok: false as const,
        response: c.json(
          createErrorResponse("unauthenticated", "Sign in required."),
          401,
        ),
      };
    }

    return { ok: true as const, session };
  }

  app.use("/api/status", authenticateDevice);
  app.use("/api/memory/*", authenticateDevice);
  app.use("/suggestions", authenticateDevice);

  app.get("/api/status", async (c) => {
    const device = c.get("device");
    const quotaCheck = await billingService.checkQuota(device.userId);

    return c.json(
      DesktopStatusResponseSchema.parse({
        status: "ok",
        data: {
          authenticated: true,
          deviceRevoked: false,
          userId: device.userId,
          planId: quotaCheck.entitlement.planId,
          quota: quotaCheck.quota,
          usage: quotaCheck.usage,
          resetAt: quotaCheck.resetAt.toISOString(),
        },
      }),
      200,
    );
  });

  app.get("/api/memory", async (c) => {
    const device = c.get("device");
    const memories = await personalMemoryService.listMemories(device.userId);

    return c.json(
      MemoryListResponseSchema.parse({
        status: "ok",
        data: { memories },
      }),
      200,
    );
  });

  app.delete("/api/memory/:id", async (c) => {
    const device = c.get("device");
    const id = c.req.param("id");

    const deleted = await personalMemoryService.deleteMemory(device.userId, id);

    if (!deleted) {
      return c.json(
        createErrorResponse("invalid_request", "Memory not found."),
        404,
      );
    }

    return c.json(
      MemoryDeleteResponseSchema.parse({
        status: "ok",
        data: { deleted: true },
      }),
      200,
    );
  });

  // Account surface routes use the browser session from Better Auth.
  app.get("/api/billing/quota", async (c) => {
    const sessionCheck = await requireSession(c);
    if (!sessionCheck.ok) return sessionCheck.response;

    const quotaCheck = await billingService.checkQuota(
      sessionCheck.session.user.id,
    );

    return c.json(
      BillingQuotaResponseSchema.parse({
        status: "ok",
        data: {
          planId: quotaCheck.entitlement.planId,
          quota: quotaCheck.quota,
          usage: quotaCheck.usage,
          resetAt: quotaCheck.resetAt.toISOString(),
          upgradeUrl: quotaCheck.ok ? undefined : "/pricing",
        },
      }),
      200,
    );
  });

  app.get("/api/billing/checkout", async (c) => {
    const sessionCheck = await requireSession(c);
    if (!sessionCheck.ok) return sessionCheck.response;

    const planIdParam = c.req.query("plan");
    if (!planIdParam || !(planIdParam in planQuotas)) {
      return c.json(
        createErrorResponse("invalid_request", "Invalid plan."),
        400,
      );
    }

    try {
      const url = await billingCheckoutClient.createCheckoutUrl(
        planIdParam as keyof typeof planQuotas,
        sessionCheck.session.user.id,
      );
      return c.json(
        BillingCheckoutResponseSchema.parse({ status: "ok", data: { url } }),
        200,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Checkout creation failed.";
      return c.json(createErrorResponse("provider_failure", message), 503);
    }
  });

  app.get("/api/billing/portal", async (c) => {
    const sessionCheck = await requireSession(c);
    if (!sessionCheck.ok) return sessionCheck.response;

    const userId = sessionCheck.session.user.id;
    const entitlement = await billingService.getEntitlement(userId);

    try {
      const url = await billingCheckoutClient.createPortalUrl(
        userId,
        entitlement.polarCustomerId,
      );
      return c.json(
        BillingPortalResponseSchema.parse({ status: "ok", data: { url } }),
        200,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Portal creation failed.";
      return c.json(createErrorResponse("provider_failure", message), 503);
    }
  });

  app.get("/api/account/memory", async (c) => {
    const sessionCheck = await requireSession(c);
    if (!sessionCheck.ok) return sessionCheck.response;

    const memories = await personalMemoryService.listMemories(
      sessionCheck.session.user.id,
    );

    return c.json(
      MemoryListResponseSchema.parse({
        status: "ok",
        data: { memories },
      }),
      200,
    );
  });

  app.delete("/api/account/memory/:id", async (c) => {
    const sessionCheck = await requireSession(c);
    if (!sessionCheck.ok) return sessionCheck.response;

    const id = c.req.param("id");
    const deleted = await personalMemoryService.deleteMemory(
      sessionCheck.session.user.id,
      id,
    );

    if (!deleted) {
      return c.json(
        createErrorResponse("invalid_request", "Memory not found."),
        404,
      );
    }

    return c.json(
      MemoryDeleteResponseSchema.parse({
        status: "ok",
        data: { deleted: true },
      }),
      200,
    );
  });

app.post("/suggestions", async (c) => {
    console.log("[suggestions] request received");
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      console.warn("[suggestions] invalid JSON body");
      return c.json(
        createErrorResponse("invalid_request", "Request body must be valid JSON."),
        400,
      );
    }

    const parseResult = SuggestionRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      console.warn(
        "[suggestions] invalid request",
        formatValidationIssues(parseResult.error.issues),
      );
      return c.json(
        createErrorResponse(
          "invalid_request",
          formatValidationIssues(parseResult.error.issues),
        ),
        400,
      );
    }

    const request = parseResult.data;
    const device = c.get("device");
    const result = await suggestionUseCase.handle(device, request);

    if (!result.ok) {
      return c.json(
        createErrorResponse(result.code, result.message, result.details),
        result.status,
      );
    }

    return c.json(createSuccessResponse(result.suggestions), 200);
  });

  app.use("/telemetry/events", authenticateDevice);

  app.post("/telemetry/events", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        createErrorResponse("invalid_request", "Request body must be valid JSON."),
        400,
      );
    }

    const parseResult = RecordTelemetryEventRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      return c.json(
        createErrorResponse(
          "invalid_request",
          formatValidationIssues(parseResult.error.issues),
        ),
        400,
      );
    }

    const request = parseResult.data;
    const device = c.get("device");

    try {
      await telemetryService.record({
        eventType: request.eventType,
        requestId: request.requestId,
        userId: device.userId,
        deviceId: device.deviceId,
        timestamp: request.timestamp,
        activeApplicationBundleId: request.activeApplicationBundleId,
        suggestionLength: request.suggestionLength,
      });
    } catch {
      // Telemetry ingestion is best-effort; still return success to the client
      // so acceptance/dismissal reporting does not block typing.
    }

    return c.json(
      TelemetryEventsResponseSchema.parse({
        status: "ok",
        data: { recorded: true },
      }),
      200,
    );
  });

  app.post("/api/billing/webhook", async (c) => {
    const webhookHandler = new BillingWebhookHandler({
      storage: billingService.storage,
    });

    const body = await c.req.text();
    const validation = webhookHandler.validateRequest(body, {
      "webhook-id": c.req.header("webhook-id"),
      "webhook-timestamp": c.req.header("webhook-timestamp"),
      "webhook-signature": c.req.header("webhook-signature"),
    });

    if (!validation.valid) {
      return c.json(
        createErrorResponse("invalid_request", validation.reason),
        400,
      );
    }

    await webhookHandler.handle(validation.payload);
    return c.json({ ok: true }, 200);
  });

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
    auth: createAuthInstance({ drizzleDatabase: database }),
    deviceTokenService: new DeviceTokenService({ storage: deviceTokenStorage }),
    billingService: new BillingService({ storage: billingStorage }),
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
