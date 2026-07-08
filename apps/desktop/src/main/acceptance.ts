import type { Suggestion, ActiveApplication } from "@tabb/contracts";
import type { TextSessionSnapshot } from "./typing-context.ts";

export type InsertionDependencies = {
  getCurrentSuggestion(): Suggestion | null;
  getPreviouslyActiveApplication(): ActiveApplication | null;
  getVisibleTextSessionTarget?(): TextSessionSnapshot | null;
  getCurrentTextSessionTarget?(): TextSessionSnapshot | null;
  insertSemantically?(text: string, target: TextSessionSnapshot): Promise<boolean>;
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

function canUseSemanticInsertion(
  targetApp: ActiveApplication,
  visible: TextSessionSnapshot | null,
  current: TextSessionSnapshot | null,
): current is TextSessionSnapshot {
  if (!visible || !current) return false;
  if (!visible.supportsSemanticInsertion || !current.supportsSemanticInsertion) return false;
  if (visible.accessibilityReliability !== "reliable" || current.accessibilityReliability !== "reliable") return false;
  if (visible.secureLike || current.secureLike) return false;
  if (!visible.focusedElementId || !visible.textElementId || !current.focusedElementId || !current.textElementId) return false;
  if (!visible.selectedRange || !current.selectedRange) return false;
  if (visible.selectedRange.length !== 0 || current.selectedRange.length !== 0) return false;

  return (
    activeApplicationKey(current.activeApplication) === activeApplicationKey(targetApp) &&
    activeApplicationKey(visible.activeApplication) === activeApplicationKey(current.activeApplication) &&
    visible.focusedElementId === current.focusedElementId &&
    visible.textElementId === current.textElementId &&
    rangeKey(visible.selectedRange) === rangeKey(current.selectedRange) &&
    visible.caretIdentity === current.caretIdentity
  );
}

async function insertWithClipboardFallback(deps: InsertionDependencies, text: string): Promise<void> {
  const previousClipboard = await deps.setClipboard(text);
  await deps.sendPaste();
  await deps.waitForPaste?.();
  await deps.restoreClipboard(previousClipboard);
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
  if (deps.insertSemantically && canUseSemanticInsertion(targetApp, visibleTarget, currentTarget)) {
    const inserted = await deps.insertSemantically(suggestion.text, currentTarget).catch(() => false);
    if (inserted) {
      return "inserted";
    }
  }

  await insertWithClipboardFallback(deps, suggestion.text);

  return "inserted";
}
