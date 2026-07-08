import type { ActiveApplication, Suggestion, SuggestionContextSource } from "@tab/contracts";
import { classifyTypingContextSource } from "@tab/memory-policy";
import type { AppContextAccessibilityTree, AppContextExtractor } from "./app-context-extractor.ts";
import type { MemoryExtractionDispatcher } from "./memory-extraction-dispatcher.ts";
import {
  createNativeSuggestionSession,
  type NativeSuggestionSessionDependencies,
} from "./native-suggestion-session.ts";
import type {
  TextSessionSnapshot,
  TypingContextBuffer,
  TypingDeletionUnit,
} from "./typing-context.ts";

export type NativeAutocompleteRuntimeDependencies = Omit<
  NativeSuggestionSessionDependencies,
  "getContextSource" | "getAppContext" | "clearAppContext"
> & {
  readonly typingContext: TypingContextBuffer;
  readonly appContext: AppContextExtractor;
  readonly memoryExtraction: MemoryExtractionDispatcher;
  readonly getContextSource?: () => SuggestionContextSource;
};

export type NativeAutocompleteRuntime = ReturnType<typeof createNativeAutocompleteRuntime>;

function activeApplicationFromState(typingContext: TypingContextBuffer): ActiveApplication | null {
  return typingContext.getState().activeApplication;
}

export function createNativeAutocompleteRuntime(deps: NativeAutocompleteRuntimeDependencies) {
  const getContextSource = deps.getContextSource ?? (() => classifyTypingContextSource(activeApplicationFromState(deps.typingContext)));
  const session = createNativeSuggestionSession({
    ...deps,
    getContextSource,
    getAppContext: (snapshot) => deps.appContext.getSnapshot(snapshot),
    clearAppContext: () => deps.appContext.clear(),
  });

  let lastOptionKeyUpAt = 0;

  function resetOptionDoublePressState(): void {
    lastOptionKeyUpAt = 0;
  }

  return {
    appendText(text: string): void {
      resetOptionDoublePressState();
      const activeApplication = activeApplicationFromState(deps.typingContext);
      if (activeApplication) {
        deps.memoryExtraction.append({
          text,
          source: getContextSource(),
          activeApplication,
        });
      }
      session.appendText(text);
    },
    appendPastedText(text: string): void {
      resetOptionDoublePressState();
      session.appendPastedText(text);
    },
    deleteBackward(unit: TypingDeletionUnit = "character"): void {
      resetOptionDoublePressState();
      session.deleteBackward(unit);
    },
    handleShortcutOrNavigation(): void {
      resetOptionDoublePressState();
    },
    setActiveApplication(bundleId: string | null, windowId: string | null = null): void {
      session.setActiveApplication(bundleId, windowId);
    },
    setSecureInput(active: boolean): void {
      session.setSecureInput(active);
    },
    applyTextSessionSnapshot(snapshot: TextSessionSnapshot): void {
      if (snapshot.accessibilityReliability === "unavailable") {
        deps.appContext.ingestAccessibilityTree({
          activeApplication: snapshot.activeApplication,
          accessibilityTree: null,
        });
      }
      session.applyTextSessionSnapshot(snapshot);
    },
    ingestAppContextTree(accessibilityTree: AppContextAccessibilityTree): void {
      deps.appContext.ingestAccessibilityTree({
        activeApplication: activeApplicationFromState(deps.typingContext),
        accessibilityTree,
      });
    },
    setPaused(active: boolean): void {
      session.setPaused(active);
    },
    async acceptCurrentSuggestion(): Promise<void> {
      await session.acceptCurrentSuggestion();
    },
    async requestSuggestionNow(): Promise<void> {
      await session.requestSuggestionNow();
    },
    handleOptionKeyUp(doublePressMs: number): boolean {
      const now = Date.now();
      if (now - lastOptionKeyUpAt <= doublePressMs) {
        lastOptionKeyUpAt = 0;
        return true;
      }

      lastOptionKeyUpAt = now;
      return false;
    },
    clearContext(): void {
      session.clearContext();
      resetOptionDoublePressState();
    },
    getCurrentSuggestion: (): Suggestion | null => session.getCurrentSuggestion(),
    getCurrentSnapshot: () => session.getCurrentSnapshot(),
    getPreviouslyActiveApplication: () => session.getPreviouslyActiveApplication(),
    isPaused: () => session.isPaused(),
    getLoopState: () => session.getLoopState(),
  };
}
