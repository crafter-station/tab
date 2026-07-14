import { FloatingSuggestionBar, type Suggestion } from "@tab/ui/components/app/floating-suggestion-bar";
import { useEffect, useState, type CSSProperties } from "react";
import { DebugContextCard, type DebugContext } from "../components/DebugContextCard";

type OverlayMode = "hidden" | "suggestion" | "debug";
type PresentedSuggestion = Suggestion & {
  source: "local" | "cloud";
  presentation?: "floating" | "inline";
  inlineMetrics?: { fontSize: number; lineHeight: number };
};
const showDeveloperDiagnostics = import.meta.env.DEV;

export function OverlaySurface() {
  const [mode, setMode] = useState<OverlayMode>("hidden");
  const [suggestion, setSuggestion] = useState<PresentedSuggestion | null>(null);
  const [suggestionRefreshing, setSuggestionRefreshing] = useState(false);
  const [debugContext, setDebugContext] = useState<DebugContext | null>(null);

  useEffect(() => {
    if (!window.tab) return;

    const unsubscribeSuggestion = window.tab.onSuggestion((nextSuggestion) => {
      setSuggestion(nextSuggestion);
      setDebugContext(null);
      setMode("suggestion");
    });
    const unsubscribeSuggestionRefreshing = window.tab.onSuggestionRefreshing(setSuggestionRefreshing);

    const unsubscribeDebugContext = showDeveloperDiagnostics
      ? window.tab.onDebugContext((debug) => {
          setDebugContext(debug);
          setSuggestion(null);
          setMode("debug");
        })
      : () => {};

    const unsubscribeHide = window.tab.onHide(() => {
      setSuggestion(null);
      setSuggestionRefreshing(false);
      setDebugContext(null);
      setMode("hidden");
    });

    window.tab.overlayReady();

    return () => {
      unsubscribeSuggestion();
      unsubscribeSuggestionRefreshing();
      unsubscribeDebugContext();
      unsubscribeHide();
    };
  }, []);

  return (
    <main className="overlay-shell" data-mode={mode}>
      {mode === "suggestion" && suggestion?.presentation === "inline" ? (
        <span
          className="inline-suggestion"
          aria-hidden="true"
          data-refreshing={suggestionRefreshing || undefined}
          style={suggestion.inlineMetrics ? {
            "--inline-font-size": `${suggestion.inlineMetrics.fontSize}px`,
            "--inline-line-height": `${suggestion.inlineMetrics.lineHeight}px`,
          } as CSSProperties : undefined}
        >
          {suggestion.text}
        </span>
      ) : (
        <FloatingSuggestionBar
          suggestion={mode === "suggestion" ? suggestion : null}
          source={suggestion?.source}
          refreshing={suggestionRefreshing}
          onAccept={() => window.tab?.acceptSuggestion()}
        />
      )}
      {showDeveloperDiagnostics ? <DebugContextCard debug={mode === "debug" ? debugContext : null} /> : null}
    </main>
  );
}
