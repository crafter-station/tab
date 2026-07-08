import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import { shouldCountSuggestionResponse } from "@tab/billing";
import { getMemoryEligibility } from "@tab/memory-policy";
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
import type { BillingService, UsageMeterService } from "./billing.ts";
import type { Device } from "./device-tokens.ts";
import type { PersonalMemoryService } from "./personal-memory.ts";
import type { TelemetryService } from "./telemetry.ts";
import { env } from "./env.ts";

const SUGGESTION_MODEL_ID = "openai/gpt-oss-20b";
export const MAX_SUGGESTION_LENGTH = 80;
const COMMON_SHORT_WORDS = new Set([
  "am",
  "an",
  "as",
  "at",
  "ay",
  "be",
  "by",
  "da",
  "de",
  "di",
  "do",
  "el",
  "en",
  "es",
  "go",
  "ha",
  "he",
  "if",
  "in",
  "is",
  "it",
  "la",
  "le",
  "lo",
  "me",
  "mi",
  "my",
  "no",
  "of",
  "on",
  "or",
  "os",
  "se",
  "si",
  "so",
  "to",
  "tu",
  "up",
  "us",
  "va",
  "ve",
  "we",
  "ya",
  "yo",
]);

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

function formatRelevantMemories(memories: readonly PersonalMemory[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map((memory) => `- ${memory.content}`);
  return `\nRelevant personal memory:\n${lines.join("\n")}`;
}

function formatAppContext(appContext: AppContext | undefined): string {
  if (!appContext || appContext.fragments.length === 0) return "";

  const lines = appContext.fragments.map(
    (fragment) => `- [${fragment.provider}/${fragment.kind}, confidence ${fragment.confidence.toFixed(2)}] ${fragment.text}`,
  );
  return `\nApp Context background (suggestion-only, do not continue this text directly):\n${lines.join("\n")}`;
}

export function createSuggestionPrompt(input: SuggestionInput): string {
  return `You are an inline autocomplete engine. Continue the user's exact text with 2-10 likely next words and never more than ${MAX_SUGGESTION_LENGTH} characters. Output only the continuation text, with no quotes, labels, explanation, or punctuation unless punctuation is the natural next character. Do not repeat any part of the user draft. If the draft ends mid-word, output only the remaining characters and following words, not the whole word. Preserve the natural boundary: do not add a leading space when completing a partial word, do add one when starting the next word, and never start with whitespace when the draft already ends with whitespace. For ordinary prose, messages, search text, and short fragments, always make a best-effort continuation. Return an empty string only for passwords, secrets, clearly sensitive data, or nonsensical input.

Active application: ${input.activeApplication.bundleId}
Source: ${input.contextSource}${formatAppContext(input.appContext)}
User draft to continue exactly: """${input.typingContext}"""${formatRelevantMemories(input.memories)}`;
}

export function normalizeGeneratedSuggestion(
  typingContext: string,
  generatedText: string,
): string {
  const cleanedText = generatedText.replace(/[\r\n]+/g, " ").trim();
  const overlapLength = findContextPrefixOverlap(typingContext, cleanedText);
  const text = normalizeSuggestionBoundary(
    typingContext,
    cleanedText.slice(overlapLength),
  );
  if (text.length === 0) return "";

  const lastContextChar = typingContext.at(-1) ?? "";
  const firstSuggestionChar = text.at(0) ?? "";
  if (
    overlapLength === 0 &&
    isLetterOrNumber(lastContextChar) &&
    isLetterOrNumber(firstSuggestionChar)
  ) {
    return ` ${truncateSuggestionText(text, MAX_SUGGESTION_LENGTH - 1)}`;
  }

  return truncateSuggestionText(text, MAX_SUGGESTION_LENGTH);
}

function truncateSuggestionText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncatedAtWordBoundary = text.slice(0, maxLength + 1).replace(/\s+\S*$/u, "").trimEnd();
  return truncatedAtWordBoundary || text.slice(0, maxLength).trimEnd();
}

function normalizeSuggestionBoundary(
  typingContext: string,
  suggestionText: string,
): string {
  if (/\s$/u.test(typingContext)) {
    return suggestionText.trimStart();
  }

  return suggestionText.replace(/^\s+/u, " ");
}

function findContextPrefixOverlap(
  typingContext: string,
  generatedText: string,
): number {
  const maxLength = Math.min(typingContext.length, generatedText.length);

  for (let length = maxLength; length >= 2; length -= 1) {
    const contextSuffix = typingContext.slice(-length);
    const suggestionPrefix = generatedText.slice(0, length);

    if (
      contextSuffix.localeCompare(suggestionPrefix, undefined, {
        sensitivity: "accent",
      }) === 0 &&
      isPlausibleRepeatedContextOverlap(typingContext, generatedText, length)
    ) {
      return length;
    }
  }

  return 0;
}

function isPlausibleRepeatedContextOverlap(
  typingContext: string,
  generatedText: string,
  overlapLength: number,
): boolean {
  const nextGeneratedChar = generatedText.at(overlapLength) ?? "";
  if (overlapLength > 2 || !isLetterOrNumber(nextGeneratedChar)) return true;

  const overlappingText = typingContext.slice(-overlapLength).toLowerCase();
  return !COMMON_SHORT_WORDS.has(overlappingText);
}

function isLetterOrNumber(value: string): boolean {
  return /[\p{Letter}\p{Number}]/u.test(value);
}

export function createRealSuggestionGenerator(): SuggestionGenerator {
  const apiKey = env.GROQ_API_KEY;
  const modelId = SUGGESTION_MODEL_ID;

  return async (input) => {
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    const prompt = createSuggestionPrompt(input);
    console.log("[suggestions] groq prompt", {
      requestId: input.requestId,
      modelId,
      prompt,
    });

    const { text } = await generateText({
      model: groq(modelId),
      prompt,
      maxOutputTokens: 128,
      providerOptions: {
        groq: { reasoningEffort: "low" },
      },
      temperature: 0.3,
    });

    const suggestionText = normalizeGeneratedSuggestion(
      input.typingContext,
      text,
    );
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

export class SuggestionUseCase {
  constructor(private readonly deps: SuggestionUseCaseDependencies) {}

  async handle(
    device: Device,
    request: SuggestionRequest,
    options: SuggestionUseCaseOptions = {},
  ): Promise<SuggestionUseCaseResult> {
    const quotaCheck = await this.deps.billingService.checkQuota(device.userId);
    if (!quotaCheck.ok) {
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
      const memories = await this.deps.personalMemoryService.selectRelevantMemories({
        userId: device.userId,
        typingContext: request.typingContext,
        activeApplication: request.activeApplication,
        memoryEnabled: true,
      });
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
