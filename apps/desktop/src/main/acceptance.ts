import type { Suggestion, ActiveApplication } from "@tab/contracts";
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
