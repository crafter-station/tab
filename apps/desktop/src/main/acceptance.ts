import type { Suggestion, ActiveApplication } from "@tab/contracts";
import { countAcceptedWords } from "@tab/billing";
import type { InsertionOutcome, InsertionStrategy } from "./application-compatibility.ts";
import type { TextSessionSnapshot } from "./typing-context.ts";

export type InsertionDependencies = {
  getCurrentSuggestion(): Suggestion | null;
  getPreviouslyActiveApplication(): ActiveApplication | null;
  getVisibleTextSessionTarget?(): TextSessionSnapshot | null;
  getCurrentTextSessionTarget?(): TextSessionSnapshot | null;
  insertSemantically?(text: string, target: TextSessionSnapshot): Promise<boolean>;
  shouldPreferClipboardFallback?(targetApp: ActiveApplication): boolean;
  recordInsertionOutcome?(strategy: InsertionStrategy, outcome: InsertionOutcome, targetApp: ActiveApplication): void;
  setClipboard(text: string): Promise<string>;
  sendPaste(): Promise<void>;
  waitForPaste?(): Promise<void>;
  restoreClipboard(previous: string): Promise<void>;
};

export type InsertionResult = "inserted" | "no_suggestion" | "no_target_app";

export type SuggestionProvenance = "automatic" | "deep_complete";

export type AcceptanceCandidate = {
  readonly suggestion: Suggestion;
  readonly provenance: SuggestionProvenance;
};

export type SuggestionAcceptanceResult = InsertionResult | "allowance_exhausted";

export type SuggestionAcceptanceDependencies = {
  readonly canAcceptLocalSuggestion?: () => boolean;
  readonly onLocalAllowanceExhausted?: () => void;
  readonly recordAcceptance?: () => void;
  readonly recordInteractionTelemetry?: (event: {
    readonly acceptanceId: string;
    readonly acceptedWordCount?: number;
    readonly acceptedCharacterCount?: number;
  }) => void;
  readonly recordAcceptedUsage?: (event: {
    readonly acceptanceId: string;
    readonly acceptedAt: string;
    readonly wordCount: number;
    readonly characterCount: number;
  }) => void | Promise<void>;
  readonly onLocalSuggestionAccepted?: (suggestionId: string) => void;
  readonly createAcceptanceId?: () => string;
  readonly now?: () => Date;
};

function rangeKey(range: TextSessionSnapshot["selectedRange"]): string {
  if (!range) return "range-unknown";
  return `${range.location}:${range.length}`;
}

function activeApplicationKey(app: ActiveApplication | null): string {
  return `${app?.bundleId ?? "app-unknown"}:${app?.windowId ?? "window-unknown"}`;
}

function isSemanticInsertionCandidate(target: TextSessionSnapshot | null): target is TextSessionSnapshot {
  if (!target) return false;
  if (!target.supportsSemanticInsertion) return false;
  if (target.accessibilityReliability !== "reliable") return false;
  if (target.secureLike) return false;
  if (!target.focusedElementId || !target.textElementId) return false;
  if (!target.selectedRange) return false;

  return target.selectedRange.length === 0;
}

function canUseSemanticInsertion(
  targetApp: ActiveApplication,
  visible: TextSessionSnapshot | null,
  current: TextSessionSnapshot | null,
): current is TextSessionSnapshot {
  if (!isSemanticInsertionCandidate(visible) || !isSemanticInsertionCandidate(current)) return false;

  const currentAppKey = activeApplicationKey(current.activeApplication);

  return (
    currentAppKey === activeApplicationKey(targetApp) &&
    activeApplicationKey(visible.activeApplication) === currentAppKey &&
    visible.focusedElementId === current.focusedElementId &&
    visible.textElementId === current.textElementId &&
    rangeKey(visible.selectedRange) === rangeKey(current.selectedRange) &&
    visible.caretIdentity === current.caretIdentity
  );
}

async function insertWithClipboardFallback(deps: InsertionDependencies, text: string): Promise<void> {
  const previousClipboard = await deps.setClipboard(text);
  let insertionFailed = false;

  try {
    await deps.sendPaste();
    await deps.waitForPaste?.();
  } catch (error) {
    insertionFailed = true;
    throw error;
  } finally {
    try {
      await deps.restoreClipboard(previousClipboard);
    } catch (error) {
      if (!insertionFailed) throw error;
    }
  }
}

function recordInsertionOutcome(
  deps: InsertionDependencies,
  strategy: InsertionStrategy,
  outcome: InsertionOutcome,
  targetApp: ActiveApplication,
): void {
  deps.recordInsertionOutcome?.(strategy, outcome, targetApp);
}

export async function acceptAndInsertSuggestion(deps: InsertionDependencies): Promise<InsertionResult> {
  const suggestion = deps.getCurrentSuggestion();
  if (!suggestion) {
    return "no_suggestion";
  }

  const targetApp = deps.getPreviouslyActiveApplication();
  if (!targetApp) {
    return "no_target_app";
  }

  const visibleTarget = deps.getVisibleTextSessionTarget?.() ?? null;
  const currentTarget = deps.getCurrentTextSessionTarget?.() ?? null;
  if (
    deps.insertSemantically &&
    !deps.shouldPreferClipboardFallback?.(targetApp) &&
    canUseSemanticInsertion(targetApp, visibleTarget, currentTarget)
  ) {
    const inserted = await deps.insertSemantically(suggestion.text, currentTarget).catch(() => false);
    if (inserted) {
      recordInsertionOutcome(deps, "semantic", "success", targetApp);
      return "inserted";
    }
    recordInsertionOutcome(deps, "semantic", "failure", targetApp);
  }

  try {
    await insertWithClipboardFallback(deps, suggestion.text);
    recordInsertionOutcome(deps, "clipboard", "success", targetApp);
  } catch (error) {
    recordInsertionOutcome(deps, "clipboard", "failure", targetApp);
    throw error;
  }

  return "inserted";
}

export function createSuggestionAcceptance(
  deps: SuggestionAcceptanceDependencies,
) {
  return {
    async accept(input: {
      readonly candidate: AcceptanceCandidate | null;
      readonly insertion: InsertionDependencies;
    }): Promise<SuggestionAcceptanceResult> {
      const { candidate } = input;
      if (
        candidate?.provenance === "automatic" &&
        deps.canAcceptLocalSuggestion &&
        !deps.canAcceptLocalSuggestion()
      ) {
        deps.onLocalAllowanceExhausted?.();
        return "allowance_exhausted";
      }

      const result = await acceptAndInsertSuggestion(input.insertion);
      if (result !== "inserted") return result;

      const acceptanceId = deps.createAcceptanceId?.() ?? crypto.randomUUID();
      const acceptedAt = (deps.now?.() ?? new Date()).toISOString();
      const acceptedWordCount = candidate
        ? countAcceptedWords(candidate.suggestion.text)
        : undefined;
      const acceptedCharacterCount = candidate?.suggestion.text.length;
      deps.recordAcceptance?.();
      deps.recordInteractionTelemetry?.({
        acceptanceId,
        acceptedWordCount,
        acceptedCharacterCount,
      });

      if (candidate?.provenance === "automatic") {
        deps.onLocalSuggestionAccepted?.(candidate.suggestion.id);
        Promise.resolve(
          deps.recordAcceptedUsage?.({
            acceptanceId,
            acceptedAt,
            wordCount: acceptedWordCount ?? 0,
            characterCount: acceptedCharacterCount ?? 0,
          }),
        ).catch(() => {
          // The durable ledger callback owns retry behavior and cannot block insertion.
        });
      }

      return result;
    },
  };
}

export type SuggestionAcceptance = ReturnType<typeof createSuggestionAcceptance>;
