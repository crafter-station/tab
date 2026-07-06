import type { Suggestion, ActiveApplication } from "@tabb/contracts";

export type InsertionDependencies = {
  getCurrentSuggestion(): Suggestion | null;
  getPreviouslyActiveApplication(): ActiveApplication | null;
  setClipboard(text: string): Promise<string>;
  sendPaste(): Promise<void>;
  restoreClipboard(previous: string): Promise<void>;
};

export type InsertionResult = "inserted" | "no_suggestion" | "no_target_app";

export async function acceptAndInsertSuggestion(deps: InsertionDependencies): Promise<InsertionResult> {
  const suggestion = deps.getCurrentSuggestion();
  if (!suggestion) {
    return "no_suggestion";
  }

  const targetApp = deps.getPreviouslyActiveApplication();
  if (!targetApp) {
    return "no_target_app";
  }

  const previousClipboard = await deps.setClipboard(suggestion.text);
  await deps.sendPaste();
  await deps.restoreClipboard(previousClipboard);

  return "inserted";
}
