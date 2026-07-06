import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Context, Next } from "hono";
import { generateText } from "ai";
import { planQuotas, shouldCountSuggestionResponse } from "@tabb/billing";
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
  type ActiveApplication,
  type PersonalMemory,
  type Suggestion,
  type SuggestionContextSource,
  type TelemetryEvent,
} from "@tabb/contracts";
import { createAuthInstance, type AuthInstance } from "./auth.ts";
import { DeviceTokenService, type Device } from "./device-tokens.ts";
import {
  BillingService,
  BillingWebhookHandler,
  type BillingCheckoutClient,
  createBillingCheckoutClient,
  UsageMeterService,
} from "./billing.ts";
import {
  PersonalMemoryService,
  type PersonalMemoryStorage,
} from "./personal-memory.ts";
import {
  BackgroundMemoryAgent,
  InMemoryMemoryJobQueue,
  type MemoryJobQueue,
} from "./memory-agent.ts";
import { getMemoryEligibility } from "@tabb/memory-policy";
import {
  TelemetryService,
  type TelemetryStorage,
} from "./telemetry.ts";

export const apiAppBoundary = {
  runtime: "cloudflare-worker-hono",
  owns: [
    "device authentication",
    "suggestion generation",
    "Personal Memory APIs",
    "billing and quota enforcement",
  ],
} as const;

export type SuggestionInput = {
  readonly requestId: string;
  readonly typingContext: string;
  readonly contextSource: SuggestionContextSource;
  readonly activeApplication: ActiveApplication;
  readonly memoryEnabled: boolean;
  readonly memories: readonly PersonalMemory[];
};

export type SuggestionGenerator = (
  input: SuggestionInput,
) => Promise<{ text: string; modelId?: string } | null>;

const SUGGESTION_MODEL_ID = "google/gemma-4-31b-it";

type ApiVariables = {
  device: Device;
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

function createQuotaExhaustedDetails(quotaCheck: {
  readonly quota: number;
  readonly usage: number;
  readonly resetAt: Date;
}) {
  return {
    quota: quotaCheck.quota,
    usage: quotaCheck.usage,
    resetAt: quotaCheck.resetAt.toISOString(),
    upgradeUrl: "/pricing",
  };
}

function formatValidationIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
}

function formatRelevantMemories(memories: readonly PersonalMemory[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map(
    (memory) => `- [${memory.category}] ${memory.content}`,
  );
  return `\nRelevant personal memory:\n${lines.join("\n")}`;
}

function createRealSuggestionGenerator(): SuggestionGenerator {
  const apiKey = process.env.AI_GATEWAY_API_KEY;

  return async (input) => {
    if (!apiKey) {
      throw new Error("AI_GATEWAY_API_KEY is not configured");
    }

    const { text } = await generateText({
      model: SUGGESTION_MODEL_ID,
      system:
        "You are a concise autocomplete assistant. Given the user's recent typing context, respond with only the most likely next few words that continue their thought. Do not explain, prefix, or quote the continuation. If there is no clear continuation, respond with an empty string.",
      prompt: `Active application: ${input.activeApplication.bundleId}\nSource: ${input.contextSource}\nContext: """${input.typingContext}"""${formatRelevantMemories(input.memories)}`,
      maxOutputTokens: 32,
      temperature: 0.3,
    });

    const trimmed = text.trim();
    if (trimmed.length === 0) return null;

    return { text: trimmed, modelId: SUGGESTION_MODEL_ID };
  };
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
    });
  const telemetryService =
    deps.telemetryService ??
    new TelemetryService({ storage: deps.telemetryStorage });

  if (memoryJobQueue instanceof InMemoryMemoryJobQueue) {
    memoryJobQueue.subscribe(async (job) => memoryAgent.processJob(job));
  }

  const app = new Hono<{ Variables: ApiVariables }>();

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
    const device = (c.get("device") as Device | undefined) ?? {
      id: "public-suggestions-device",
      userId: "public-suggestions-user",
      deviceId: request.deviceId,
      tokenHash: "public",
      platform: request.clientMetadata?.platform ?? "unknown",
      appVersion: request.clientMetadata?.appVersion ?? "unknown",
      createdAt: new Date(),
      lastSeenAt: new Date(),
      revoked: false,
    };
    console.log("[suggestions] parsed request", {
      requestId: request.requestId,
      deviceId: device.deviceId,
      userId: device.userId,
      contextLength: request.typingContext.length,
      contextSource: request.contextSource,
      activeApplication: request.activeApplication.bundleId,
      memoryEnabled: request.memoryEnabled,
      redactionApplied: request.redaction.applied,
    });

    const quotaCheck = await billingService.checkQuota(device.userId);
    if (!quotaCheck.ok) {
      console.warn("[suggestions] quota exhausted", {
        requestId: request.requestId,
        userId: device.userId,
        usage: quotaCheck.usage,
        quota: quotaCheck.quota,
      });
      return c.json(
        createErrorResponse(
          "quota_exhausted",
          "Monthly autocomplete quota exhausted. Upgrade to continue.",
          createQuotaExhaustedDetails(quotaCheck),
        ),
        402,
      );
    }

    async function recordSuggestionEvent(
      event: Omit<TelemetryEvent, "id" | "requestId" | "userId" | "deviceId">,
    ): Promise<void> {
      try {
        await telemetryService.record({
          ...event,
          requestId: request.requestId,
          userId: device.userId,
          deviceId: device.deviceId,
        });
      } catch {
        // Telemetry is best-effort; do not fail the hot suggestion response.
      }
    }

    const suggestionStart = performance.now();

    try {
      const memories = await personalMemoryService.selectRelevantMemories({
        userId: device.userId,
        typingContext: request.typingContext,
        activeApplication: request.activeApplication,
        memoryEnabled: request.memoryEnabled,
      });

      const generated = await generateSuggestion({
        requestId: request.requestId,
        typingContext: request.typingContext,
        contextSource: request.contextSource,
        activeApplication: request.activeApplication,
        memoryEnabled: request.memoryEnabled,
        memories,
      });
      console.log("[suggestions] model result", {
        requestId: request.requestId,
        modelId: generated?.modelId,
        suggestionLength: generated?.text.length ?? 0,
      });

      const latencyMs = Math.round(performance.now() - suggestionStart);

      const suggestions: Suggestion[] = generated?.text
        ? [
            {
              id: `sg-${request.requestId}`,
              text: generated.text,
            },
          ]
        : [];

      await recordSuggestionEvent({
        eventType: "suggestion_shown",
        timestamp: new Date().toISOString(),
        activeApplicationBundleId: request.activeApplication.bundleId,
        contextSource: request.contextSource,
        suggestionLength: suggestions[0]?.text.length ?? 0,
        planId: quotaCheck.entitlement.planId,
        modelId: generated?.modelId,
        latencyMs,
        redactionApplied: request.redaction.applied,
        redactionCount: request.redaction.redactionCount,
        clientAppVersion: request.clientMetadata?.appVersion,
        clientPlatform: request.clientMetadata?.platform,
      });

      if (shouldCountSuggestionResponse(suggestions.length)) {
        await billingService.consumeSuggestion(device.userId);
        usageMeterService
          .recordUsage({
            userId: device.userId,
            requestId: request.requestId,
            timestamp: new Date(),
          })
          .catch(() => {
            // Ingestion failures are retried by the meter service; do not fail
            // the hot suggestion response when Polar ingestion is unavailable.
          });
      }

      if (suggestions.length === 0) {
        console.log("[suggestions] returning empty suggestions", {
          requestId: request.requestId,
          latencyMs,
        });
      }

      const memoryEligibility = getMemoryEligibility(request.contextSource);
      if (request.memoryEnabled && memoryEligibility.eligible) {
        try {
          await memoryJobQueue.enqueue({
            requestId: request.requestId,
            userId: device.userId,
            typingContext: request.typingContext,
            contextSource: request.contextSource,
            activeApplication: request.activeApplication,
            memoryEligible: true,
            redaction: request.redaction,
            clientMetadata: request.clientMetadata,
          });

          await recordSuggestionEvent({
            eventType: "memory_job_enqueued",
            timestamp: new Date().toISOString(),
            activeApplicationBundleId: request.activeApplication.bundleId,
            contextSource: request.contextSource,
            planId: quotaCheck.entitlement.planId,
            memoryEligible: true,
            redactionApplied: request.redaction.applied,
            redactionCount: request.redaction.redactionCount,
            clientAppVersion: request.clientMetadata?.appVersion,
            clientPlatform: request.clientMetadata?.platform,
          });
        } catch {
          // Background memory jobs are best-effort; do not fail the hot
          // suggestion response when enqueueing is unavailable.
        }
      }

      return c.json(createSuccessResponse(suggestions), 200);
    } catch (error) {
      const latencyMs = Math.round(performance.now() - suggestionStart);
      const message =
        error instanceof Error ? error.message : "Suggestion generation failed.";
      console.error("[suggestions] provider failure", {
        requestId: request.requestId,
        latencyMs,
        message,
      });

      await recordSuggestionEvent({
        eventType: "suggestion_error",
        timestamp: new Date().toISOString(),
        activeApplicationBundleId: request.activeApplication.bundleId,
        contextSource: request.contextSource,
        planId: quotaCheck.entitlement.planId,
        latencyMs,
        errorCode: "provider_failure",
        redactionApplied: request.redaction.applied,
        redactionCount: request.redaction.redactionCount,
        clientAppVersion: request.clientMetadata?.appVersion,
        clientPlatform: request.clientMetadata?.platform,
      });

      return c.json(createErrorResponse("provider_failure", message), 503);
    }
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

export default defaultApp;

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
