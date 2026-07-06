import { Hono } from "hono";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  ApiErrorResponseSchema,
  ApiSuccessResponseSchema,
  SuggestionRequestSchema,
  type ActiveApplication,
  type Suggestion,
  type SuggestionContextSource,
} from "@tabb/contracts";

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

function createErrorResponse(
  code: "invalid_request" | "provider_failure",
  message: string,
) {
  return ApiErrorResponseSchema.parse({
    status: "error",
    error: { code, message },
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

function getProviderBaseUrl(accountId: string | undefined, gatewayId: string): string {
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
          ? { "cf-aig-authorization": `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }
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
};

export function createApp(deps: ApiDependencies = {}) {
  const generateSuggestion = deps.generateSuggestion ?? createRealSuggestionGenerator();
  const app = new Hono();

  app.post("/suggestions", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(createErrorResponse("invalid_request", "Request body must be valid JSON."), 400);
    }

    const parseResult = SuggestionRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      return c.json(
        createErrorResponse("invalid_request", formatValidationIssues(parseResult.error.issues)),
        400,
      );
    }

    const request = parseResult.data;

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

      return c.json(
        createSuccessResponse(suggestions),
        200,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Suggestion generation failed.";
      return c.json(createErrorResponse("provider_failure", message), 503);
    }
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
