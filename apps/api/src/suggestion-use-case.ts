import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import { shouldCountSuggestionResponse } from "@tabb/billing";
import { getMemoryEligibility } from "@tabb/memory-policy";
import type {
  ActiveApplication,
  EntitlementErrorDetails,
  PersonalMemory,
  Suggestion,
  SuggestionContextSource,
  SuggestionRequest,
  TelemetryEvent,
} from "@tabb/contracts";
import type { BillingService, UsageMeterService } from "./billing.ts";
import type { Device } from "./device-tokens.ts";
import type { MemoryJobQueue } from "./memory-agent.ts";
import type { PersonalMemoryService } from "./personal-memory.ts";
import type { TelemetryService } from "./telemetry.ts";
import { env } from "./env.ts";

const SUGGESTION_MODEL_ID = "llama-3.1-8b-instant";

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

export type SuggestionUseCaseDependencies = {
  readonly billingService: BillingService;
  readonly usageMeterService: UsageMeterService;
  readonly personalMemoryService: PersonalMemoryService;
  readonly memoryJobQueue: MemoryJobQueue;
  readonly telemetryService: TelemetryService;
  readonly generateSuggestion: SuggestionGenerator;
};

export type SuggestionUseCaseResult =
  | { readonly ok: true; readonly suggestions: Suggestion[] }
  | {
      readonly ok: false;
      readonly status: 402 | 503;
      readonly code: "billing_required" | "quota_exhausted" | "provider_failure";
      readonly message: string;
      readonly details?: EntitlementErrorDetails;
    };

function formatRelevantMemories(memories: readonly PersonalMemory[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map(
    (memory) => `- [${memory.category}] ${memory.content}`,
  );
  return `\nRelevant personal memory:\n${lines.join("\n")}`;
}

export function normalizeGeneratedSuggestion(
  typingContext: string,
  generatedText: string,
): string {
  const text = generatedText.replace(/[\r\n]+/g, " ").trim();
  if (text.length === 0) return "";

  const lastContextChar = typingContext.at(-1) ?? "";
  const firstSuggestionChar = text.at(0) ?? "";
  if (/\w/.test(lastContextChar) && /\w/.test(firstSuggestionChar)) {
    return ` ${text}`;
  }

  return text;
}

export function createRealSuggestionGenerator(): SuggestionGenerator {
  const apiKey = env.GROQ_API_KEY;
  const modelId = SUGGESTION_MODEL_ID;

  return async (input) => {
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    const { text } = await generateText({
      model: groq(modelId),
      system:
        "You are an inline autocomplete engine. Continue the user's exact text with 2-10 likely next words. Output only the continuation text, with no quotes, labels, explanation, or punctuation unless punctuation is the natural next character. For ordinary prose, messages, search text, and short fragments, always make a best-effort continuation. Return an empty string only for passwords, secrets, clearly sensitive data, or nonsensical input.",
      prompt: `Active application: ${input.activeApplication.bundleId}\nSource: ${input.contextSource}\nContext: """${input.typingContext}"""${formatRelevantMemories(input.memories)}`,
      maxOutputTokens: 32,
      temperature: 0.3,
    });

    return {
      text: normalizeGeneratedSuggestion(input.typingContext, text),
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

export class SuggestionUseCase {
  constructor(private readonly deps: SuggestionUseCaseDependencies) {}

  async handle(device: Device, request: SuggestionRequest): Promise<SuggestionUseCaseResult> {
    const quotaCheck = await this.deps.billingService.checkQuota(device.userId);
    if (!quotaCheck.ok) {
      if (quotaCheck.reason === "billing_required") {
        return {
          ok: false,
          status: 402,
          code: "billing_required",
          message: "Choose the free plan in Polar to continue using Tabb.",
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

    try {
      const memories = await this.deps.personalMemoryService.selectRelevantMemories({
        userId: device.userId,
        typingContext: request.typingContext,
        activeApplication: request.activeApplication,
        memoryEnabled: request.memoryEnabled,
      });

      const generated = await this.deps.generateSuggestion({
        requestId: request.requestId,
        typingContext: request.typingContext,
        contextSource: request.contextSource,
        activeApplication: request.activeApplication,
        memoryEnabled: request.memoryEnabled,
        memories,
      });

      const latencyMs = Math.round(performance.now() - suggestionStart);
      const suggestions: Suggestion[] = generated?.text
        ? [{ id: `sg-${request.requestId}`, text: generated.text }]
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
        await this.deps.billingService.consumeSuggestion(device.userId);
        this.deps.usageMeterService
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
      }

      const memoryEligibility = getMemoryEligibility(request.contextSource);
      if (request.memoryEnabled && memoryEligibility.eligible) {
        try {
          await this.deps.memoryJobQueue.enqueue({
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

      return { ok: true, suggestions };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - suggestionStart);
      const message = error instanceof Error ? error.message : "Suggestion generation failed.";

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
}
