import { Hono } from "hono";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { shouldCountSuggestionResponse } from "@tabb/billing";
import {
  ApiErrorResponseSchema,
  ApiSuccessResponseSchema,
  DeviceAuthorizeResponseSchema,
  DeviceTokenExchangeRequestSchema,
  DeviceTokenExchangeResponseSchema,
  SuggestionRequestSchema,
  type ActiveApplication,
  type Suggestion,
  type SuggestionContextSource,
} from "@tabb/contracts";
import { createAuthInstance, type AuthInstance } from "./auth.ts";
import { DeviceTokenService, type Device } from "./device-tokens.ts";
import {
  BillingService,
  BillingWebhookHandler,
  UsageMeterService,
} from "./billing.ts";

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
};

export type SuggestionGenerator = (
  input: SuggestionInput,
) => Promise<{ text: string } | null>;

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

function getProviderBaseUrl(
  accountId: string | undefined,
  gatewayId: string,
): string {
  if (accountId && gatewayId) {
    return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`;
  }

  return "https://api.openai.com/v1";
}

function createRealSuggestionGenerator(): SuggestionGenerator {
  const apiKey = process.env.OPENAI_API_KEY;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID ?? "tabb";
  const modelId = process.env.TABB_SUGGESTION_MODEL ?? "gpt-4o-mini";

  return async (input) => {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const baseURL = getProviderBaseUrl(accountId, gatewayId);

    const openai = createOpenAI({
      apiKey,
      baseURL,
      headers: {
        // Per Cloudflare AI Gateway docs, include a gateway ID header when the
        // environment supplies a Cloudflare API token for authenticated gateways.
        ...(process.env.CLOUDFLARE_API_TOKEN
          ? {
              "cf-aig-authorization": `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            }
          : {}),
      },
    });

    const { text } = await generateText({
      // AI Gateway provider-specific endpoints expose /chat/completions, so use
      // the chat completions model factory rather than the default Responses API.
      model: openai.chat(modelId),
      system:
        "You are a concise autocomplete assistant. Given the user's recent typing context, respond with only the most likely next few words that continue their thought. Do not explain, prefix, or quote the continuation. If there is no clear continuation, respond with an empty string.",
      prompt: `Active application: ${input.activeApplication.bundleId}\nSource: ${input.contextSource}\nContext: """${input.typingContext}"""`,
      maxOutputTokens: 32,
      temperature: 0.3,
    });

    const trimmed = text.trim();
    if (trimmed.length === 0) return null;

    return { text: trimmed };
  };
}

export type ApiDependencies = {
  readonly generateSuggestion?: SuggestionGenerator;
  readonly auth?: AuthInstance;
  readonly deviceTokenService?: DeviceTokenService;
  readonly billingService?: BillingService;
  readonly usageMeterService?: UsageMeterService;
};

export function createApp(deps: ApiDependencies = {}) {
  const generateSuggestion =
    deps.generateSuggestion ?? createRealSuggestionGenerator();
  const auth = deps.auth ?? createAuthInstance();
  const deviceTokenService =
    deps.deviceTokenService ?? new DeviceTokenService();
  const billingService = deps.billingService ?? new BillingService();
  const usageMeterService = deps.usageMeterService ?? new UsageMeterService();

  const app = new Hono<{ Variables: ApiVariables }>();

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

  // Better Auth owns users, sessions, and password/credential flows.
  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  // Product APIs require a valid, non-revoked device token.
  app.use("/suggestions", async (c, next) => {
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
  });

  app.post("/suggestions", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        createErrorResponse("invalid_request", "Request body must be valid JSON."),
        400,
      );
    }

    const parseResult = SuggestionRequestSchema.safeParse(payload);
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

    const quotaCheck = await billingService.checkQuota(device.userId);
    if (!quotaCheck.ok) {
      return c.json(
        createErrorResponse(
          "quota_exhausted",
          "Monthly autocomplete quota exhausted. Upgrade to continue.",
          createQuotaExhaustedDetails(quotaCheck),
        ),
        402,
      );
    }

    try {
      const generated = await generateSuggestion({
        requestId: request.requestId,
        typingContext: request.typingContext,
        contextSource: request.contextSource,
        activeApplication: request.activeApplication,
        memoryEnabled: request.memoryEnabled,
      });

      const suggestions: Suggestion[] = generated?.text
        ? [
            {
              id: `sg-${request.requestId}`,
              text: generated.text,
            },
          ]
        : [];

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

      return c.json(createSuccessResponse(suggestions), 200);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Suggestion generation failed.";
      return c.json(createErrorResponse("provider_failure", message), 503);
    }
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
