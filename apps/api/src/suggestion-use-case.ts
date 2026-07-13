import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import { shouldCountSuggestionResponse } from "@tab/billing";
import { getMemoryEligibility } from "@tab/memory-policy";
import {
  createSuggestionPrompt,
  createSuggestionMessages,
  isSuggestionContractValid,
  MAX_SUGGESTION_LENGTH,
  MAX_SUGGESTION_TOKENS,
  normalizeGeneratedSuggestion,
} from "@tab/suggestion-policy";
import type {
  ActiveApplication,
  AppContext,
  EntitlementErrorDetails,
  PersonalMemory,
  Suggestion,
  SuggestionContextSource,
  SuggestionRequest,
  TelemetryEvent,
} from "@tab/contracts";
import type {
  BillingService,
  QuotaCheckResult,
  UsageMeterService,
} from "./billing.ts";
import type { Device } from "./device-tokens.ts";
import type { PersonalMemoryService } from "./personal-memory.ts";
import type { TelemetryService } from "./telemetry.ts";
import { env } from "./env.ts";

const SUGGESTION_MODEL_ID = "llama-3.1-8b-instant";
const MEMORY_RETRIEVAL_BUDGET_MS = 35;

export { createSuggestionPrompt, MAX_SUGGESTION_LENGTH, normalizeGeneratedSuggestion };

export type SuggestionInput = {
  readonly requestId: string;
  readonly typingContext: string;
  readonly contextSource: SuggestionContextSource;
  readonly activeApplication: ActiveApplication;
  readonly memoryEnabled: boolean;
  readonly memories: readonly PersonalMemory[];
  readonly appContext?: AppContext;
};

export type SuggestionGenerator = (
  input: SuggestionInput,
) => Promise<{ text: string; modelId?: string } | null>;

export type SuggestionUseCaseDependencies = {
  readonly billingService: BillingService;
  readonly usageMeterService: UsageMeterService;
  readonly personalMemoryService: PersonalMemoryService;
  readonly telemetryService: TelemetryService;
  readonly generateSuggestion: SuggestionGenerator;
};

export type SuggestionUseCaseResult =
  | { readonly ok: true; readonly suggestions: Suggestion[] }
  | {
      readonly ok: false;
      readonly status: 402 | 503;
      readonly code:
        "billing_required" | "quota_exhausted" | "provider_failure";
      readonly message: string;
      readonly details?: EntitlementErrorDetails;
    };

export type SuggestionUseCaseOptions = {
  readonly waitUntil?: (promise: Promise<unknown>) => void;
};

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(resolve, timeoutMs, fallback);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createRealSuggestionGenerator(): SuggestionGenerator {
  const apiKey = env.GROQ_API_KEY;
  const modelId = SUGGESTION_MODEL_ID;

  return async (input) => {
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    const [systemMessage, ...messages] = createSuggestionMessages(input);
    const { text } = await generateText({
      model: groq(modelId),
      instructions: systemMessage?.content,
      messages,
      maxOutputTokens: MAX_SUGGESTION_TOKENS,
      temperature: 0.3,
    });

    const suggestionText = normalizeGeneratedSuggestion(
      input.typingContext,
      text,
    );
    if (!isSuggestionContractValid(input.typingContext, suggestionText)) {
      return null;
    }
    console.log("[suggestions] groq generated suggestion", {
      requestId: input.requestId,
      modelId,
      text: suggestionText,
    });

    return {
      text: suggestionText,
      modelId,
    };
  };
}

function createQuotaExhaustedDetails(quotaCheck: {
  readonly quota: number;
  readonly usage: number;
  readonly resetAt: Date;
}): EntitlementErrorDetails {
  return {
    quota: quotaCheck.quota,
    usage: quotaCheck.usage,
    resetAt: quotaCheck.resetAt.toISOString(),
    upgradeUrl: "/pricing",
  };
}

function createEntitlementError(
  quotaCheck: Extract<QuotaCheckResult, { readonly ok: false }>,
): SuggestionUseCaseResult {
  if (quotaCheck.reason === "billing_required") {
    return {
      ok: false,
      status: 402,
      code: "billing_required",
      message: "Choose the free plan in Polar to continue using Tab.",
      details: {
        ...createQuotaExhaustedDetails(quotaCheck),
        upgradeUrl: "/billing/checkout?plan=free",
      },
    };
  }

  return {
    ok: false,
    status: 402,
    code: "quota_exhausted",
    message: "Monthly autocomplete quota exhausted. Upgrade to continue.",
    details: createQuotaExhaustedDetails(quotaCheck),
  };
}

export class SuggestionUseCase {
  constructor(private readonly deps: SuggestionUseCaseDependencies) {}

  async handle(
    device: Device,
    request: SuggestionRequest,
    options: SuggestionUseCaseOptions = {},
  ): Promise<SuggestionUseCaseResult> {
    const quotaCheck = await this.deps.billingService.checkQuota(device.userId);
    if (!quotaCheck.ok) {
      return createEntitlementError(quotaCheck);
    }

    const suggestionStart = performance.now();

    const recordSuggestionEvent = async (
      event: Omit<TelemetryEvent, "id" | "requestId" | "userId" | "deviceId">,
    ): Promise<void> => {
      try {
        await this.deps.telemetryService.record({
          ...event,
          requestId: request.requestId,
          userId: device.userId,
          deviceId: device.deviceId,
        });
      } catch {
        // Telemetry is best-effort; do not fail the hot suggestion response.
      }
    };

    const memories = await this.selectRelevantMemories(device, request);

    try {
      const generated = await this.deps.generateSuggestion({
        requestId: request.requestId,
        typingContext: request.typingContext,
        contextSource: request.contextSource,
        activeApplication: request.activeApplication,
        memoryEnabled: request.memoryEnabled,
        memories,
        appContext: request.appContext,
      });

      const latencyMs = Math.round(performance.now() - suggestionStart);
      const suggestions: Suggestion[] = generated?.text
        ? [{ id: `sg-${request.requestId}`, text: generated.text }]
        : [];
      const shouldConsume = shouldCountSuggestionResponse(suggestions.length);

      if (shouldConsume) {
        const consumption = await this.deps.billingService.consumeSuggestion(
          device.userId,
        );
        if (!consumption.ok) {
          return createEntitlementError(consumption);
        }
      }

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

      if (shouldConsume) {
        const usageMeterPromise = this.deps.usageMeterService
          .recordUsage({
            userId: device.userId,
            requestId: request.requestId,
            timestamp: new Date(),
            creditsSpent: 1,
          })
          .catch(() => {
            // Ingestion failures are retried by the meter service; do not fail
            // the hot suggestion response when Polar ingestion is unavailable.
          });

        options.waitUntil?.(usageMeterPromise);
      }

      return { ok: true, suggestions };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - suggestionStart);
      const message =
        error instanceof Error
          ? error.message
          : "Suggestion generation failed.";

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

      return {
        ok: false,
        status: 503,
        code: "provider_failure",
        message,
      };
    }
  }

  private async selectRelevantMemories(
    device: Device,
    request: SuggestionRequest,
  ): Promise<readonly PersonalMemory[]> {
    if (!request.memoryEnabled) {
      console.log("[suggestions] memory skipped", {
        requestId: request.requestId,
        reason: "disabled",
      });
      return [];
    }

    try {
      const retrieval = this.deps.personalMemoryService.selectRelevantMemories({
        userId: device.userId,
        typingContext: request.typingContext,
        activeApplication: request.activeApplication,
        memoryEnabled: true,
      });
      const memories = await withDeadline(retrieval, MEMORY_RETRIEVAL_BUDGET_MS, []);
      console.log("[suggestions] memory selected", {
        requestId: request.requestId,
        count: memories.length,
      });
      return memories;
    } catch {
      // Memory retrieval is best-effort; suggestions continue without memory.
      console.log("[suggestions] memory skipped", {
        requestId: request.requestId,
        reason: "retrieval_failed",
      });
      return [];
    }
  }
}
