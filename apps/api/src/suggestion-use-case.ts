import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import { shouldCountDeepComplete } from "@tab/billing";
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
  DeepCompleteCheckResult,
  UsageMeterService,
} from "./billing.ts";
import type { Device } from "./device-tokens.ts";
import type { PersonalMemoryService } from "./personal-memory.ts";
import type { TelemetryService } from "./telemetry.ts";
import { env } from "./env.ts";

const SUGGESTION_MODEL_ID = "llama-3.1-8b-instant";

export { createSuggestionPrompt, MAX_SUGGESTION_LENGTH, normalizeGeneratedSuggestion };

export type SuggestionInput = {
  readonly requestId: string;
  readonly typingContext: string;
  readonly contextSource: SuggestionContextSource;
  readonly activeApplication: ActiveApplication;
  readonly memoryEnabled: boolean;
  readonly memories: readonly PersonalMemory[];
  readonly appContext?: AppContext;
  readonly customWritingInstructions?: string;
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
      readonly status: 402 | 409 | 503;
      readonly code:
        "invalid_request" | "quota_exhausted" | "provider_failure";
      readonly message: string;
      readonly details?: EntitlementErrorDetails;
    };

export type SuggestionUseCaseOptions = {
  readonly waitUntil?: (promise: Promise<unknown>) => void;
};

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
    capability: "deep_completes",
    limit: quotaCheck.quota,
    used: quotaCheck.usage,
    resetAt: quotaCheck.resetAt.toISOString(),
    upgradeUrl: "/pricing",
  };
}

function createEntitlementError(
  quotaCheck: DeepCompleteCheckResult,
): SuggestionUseCaseResult {
  return {
    ok: false,
    status: 402,
    code: "quota_exhausted",
    message: "Monthly Deep Complete allowance exhausted. Local Suggestions remain available.",
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
    const quotaCheck = await this.deps.billingService.consumeDeepComplete(
      device.userId,
      request.requestId,
    );
    if (!quotaCheck.ok) {
      return createEntitlementError(quotaCheck);
    }
    if (!quotaCheck.recorded) {
      return {
        ok: false,
        status: 409,
        code: "invalid_request",
        message: "This Deep Complete request id has already been used.",
      };
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
        customWritingInstructions: quotaCheck.status.capabilities
          .customWritingInstructions
          ? request.customWritingInstructions
          : undefined,
      });

      const latencyMs = Math.round(performance.now() - suggestionStart);
      const suggestions: Suggestion[] = generated?.text
        ? [{ id: `sg-${request.requestId}`, text: generated.text }]
        : [];
      const shouldConsume = shouldCountDeepComplete(suggestions.length);
      if (!shouldConsume) {
        await this.deps.billingService.releaseDeepComplete(
          device.userId,
          request.requestId,
        );
      }

      const suggestionEvent: Parameters<typeof recordSuggestionEvent>[0] = {
        eventType: "suggestion_generated" as const,
        timestamp: new Date().toISOString(),
        contextSource: request.contextSource,
        suggestionLength: suggestions[0]?.text.length ?? 0,
        planId: quotaCheck.entitlement.planId,
        modelId: generated?.modelId,
        inferenceSource: "deep_complete",
        trigger: "explicit",
        memoryUsed: memories.length > 0,
        memoryCount: memories.length,
        providerId: "groq",
        latencyMs,
        redactionApplied: request.redaction.applied,
        redactionCount: request.redaction.redactionCount,
        clientAppVersion: request.clientMetadata?.appVersion,
        clientPlatform: request.clientMetadata?.platform,
      };
      const recordTelemetry = async () => {
        await recordSuggestionEvent(suggestionEvent);
        if (suggestions.length > 0) {
          await recordSuggestionEvent({
            ...suggestionEvent,
            eventType: "suggestion_shown",
          });
        }
      };
      const telemetryPromise = recordTelemetry();
      if (options.waitUntil) {
        options.waitUntil(telemetryPromise);
      } else {
        await telemetryPromise;
      }

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
      await this.deps.billingService.releaseDeepComplete(
        device.userId,
        request.requestId,
      );
      const latencyMs = Math.round(performance.now() - suggestionStart);
      const message =
        error instanceof Error
          ? error.message
          : "Suggestion generation failed.";

      await recordSuggestionEvent({
        eventType: "suggestion_error",
        timestamp: new Date().toISOString(),
        contextSource: request.contextSource,
        planId: quotaCheck.entitlement.planId,
        inferenceSource: "deep_complete",
        trigger: "explicit",
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
      return [];
    }

    try {
      return await this.deps.personalMemoryService.selectRelevantMemories({
        userId: device.userId,
        typingContext: request.typingContext,
        activeApplication: request.activeApplication,
        memoryEnabled: true,
      });
    } catch {
      // Memory retrieval is best-effort; suggestions continue without memory.
      return [];
    }
  }
}
