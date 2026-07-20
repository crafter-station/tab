import type { Suggestion, ActiveApplication } from "@tab/contracts";
import { countAcceptedWords } from "@tab/billing";
import type { InsertionOutcome, InsertionStrategy } from "./application-compatibility.ts";
import { hasConcreteRewriteIdentity, type TextSessionSnapshot } from "./typing-context.ts";
import { detectSensitiveData } from "@tab/redaction";

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
  onDiagnostic?(diagnostic: AcceptanceDiagnostic): void;
};

export type AcceptanceDiagnostic = {
  readonly stage: "target-revalidation" | "clipboard-write" | "paste-dispatch" | "paste-wait" | "clipboard-restoration" | "insertion-outcome" | "acceptance-error";
  readonly outcome: "started" | "matched" | "stale" | "succeeded" | "failed";
};

export type InsertionResult = "inserted" | "no_suggestion" | "no_target_app";

export type SuggestionProvenance = "automatic" | "deep_complete" | "rewrite";

export type AcceptanceCandidate = {
  readonly suggestion: Suggestion;
  readonly provenance: SuggestionProvenance;
};

export type SuggestionAcceptanceResult = InsertionResult | "allowance_exhausted" | "stale_target";

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

function exactRewriteTargetMatches(
  targetApp: ActiveApplication | null,
  visible: TextSessionSnapshot | null,
  current: TextSessionSnapshot | null,
): boolean {
  if (!targetApp || !visible || !current) return false;
  if (!hasConcreteRewriteIdentity(visible) || !hasConcreteRewriteIdentity(current)) return false;
  if (visible.accessibilityReliability !== "reliable" || current.accessibilityReliability !== "reliable") return false;
  if (visible.secureLike || current.secureLike) return false;
  if (!visible.activeApplication?.windowId || !current.activeApplication?.windowId) return false;
  if (!visible.focusedElementId || !current.focusedElementId || !visible.textElementId || !current.textElementId) return false;
  if (!visible.selectedRange || !current.selectedRange) return false;
  if (visible.selectedRange.length === 0 || current.selectedRange.length === 0) return false;
  if (visible.selectedText === undefined || current.selectedText === undefined) return false;
  if (visible.selectedText.length !== visible.selectedRange.length || current.selectedText.length !== current.selectedRange.length) return false;
  if (
    visible.surroundingContext?.beforeCaret === undefined ||
    visible.surroundingContext.afterCaret === undefined ||
    current.surroundingContext?.beforeCaret === undefined ||
    current.surroundingContext.afterCaret === undefined
  ) return false;
  if (activeApplicationKey(targetApp) !== activeApplicationKey(current.activeApplication)) return false;

  const exact =
    activeApplicationKey(visible.activeApplication) === activeApplicationKey(current.activeApplication) &&
    visible.focusedElementId === current.focusedElementId &&
    visible.textElementId === current.textElementId &&
    rangeKey(visible.selectedRange) === rangeKey(current.selectedRange) &&
    visible.caretIdentity === current.caretIdentity &&
    visible.selectedText === current.selectedText &&
    visible.surroundingContext.beforeCaret === current.surroundingContext.beforeCaret &&
    visible.surroundingContext.afterCaret === current.surroundingContext.afterCaret;
  if (!exact) return false;

  return !detectSensitiveData([
    current.selectedText,
    current.surroundingContext.beforeCaret,
    current.surroundingContext.afterCaret,
  ].join("\n")).hasSensitiveData;
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
  deps.onDiagnostic?.({ stage: "clipboard-write", outcome: "started" });
  let previousClipboard: string;
  try {
    previousClipboard = await deps.setClipboard(text);
    deps.onDiagnostic?.({ stage: "clipboard-write", outcome: "succeeded" });
  } catch (error) {
    deps.onDiagnostic?.({ stage: "clipboard-write", outcome: "failed" });
    throw error;
  }

  try {
    deps.onDiagnostic?.({ stage: "paste-dispatch", outcome: "started" });
    try {
      await deps.sendPaste();
      deps.onDiagnostic?.({ stage: "paste-dispatch", outcome: "succeeded" });
    } catch (error) {
      deps.onDiagnostic?.({ stage: "paste-dispatch", outcome: "failed" });
      throw error;
    }
    deps.onDiagnostic?.({ stage: "paste-wait", outcome: "started" });
    try {
      await deps.waitForPaste?.();
      deps.onDiagnostic?.({ stage: "paste-wait", outcome: "succeeded" });
    } catch (error) {
      deps.onDiagnostic?.({ stage: "paste-wait", outcome: "failed" });
      throw error;
    }
  } finally {
    deps.onDiagnostic?.({ stage: "clipboard-restoration", outcome: "started" });
    try {
      await deps.restoreClipboard(previousClipboard);
      deps.onDiagnostic?.({ stage: "clipboard-restoration", outcome: "succeeded" });
    } catch {
      deps.onDiagnostic?.({ stage: "clipboard-restoration", outcome: "failed" });
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
    deps.onDiagnostic?.({ stage: "insertion-outcome", outcome: "succeeded" });
  } catch (error) {
    recordInsertionOutcome(deps, "clipboard", "failure", targetApp);
    deps.onDiagnostic?.({ stage: "insertion-outcome", outcome: "failed" });
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
      let insertion = input.insertion;
      if (
        candidate?.provenance === "automatic" &&
        deps.canAcceptLocalSuggestion &&
        !deps.canAcceptLocalSuggestion()
      ) {
        deps.onLocalAllowanceExhausted?.();
        return "allowance_exhausted";
      }

      if (candidate?.provenance === "rewrite") {
        const targetApp = insertion.getPreviouslyActiveApplication();
        const visibleTarget = insertion.getVisibleTextSessionTarget?.() ?? null;
        const currentTarget = insertion.getCurrentTextSessionTarget?.() ?? null;
        const targetMatches = exactRewriteTargetMatches(targetApp, visibleTarget, currentTarget);
        insertion.onDiagnostic?.({
          stage: "target-revalidation",
          outcome: targetMatches ? "matched" : "stale",
        });
        if (!targetMatches) {
          return "stale_target";
        }
        insertion = {
          ...insertion,
          getCurrentSuggestion: () => candidate.suggestion,
          getCurrentTextSessionTarget: () => currentTarget,
          insertSemantically: undefined,
        };
      }

      const result = await acceptAndInsertSuggestion(insertion);
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
