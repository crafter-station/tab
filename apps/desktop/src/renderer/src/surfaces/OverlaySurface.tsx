import { FloatingSuggestionBar, type Suggestion } from "@tab/ui";
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
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [debugContext, setDebugContext] = useState<DebugContext | null>(null);

  useEffect(() => {
    if (!window.tab) return;

    const unsubscribeSuggestion = window.tab.onSuggestion((nextSuggestion) => {
      setSuggestion(nextSuggestion);
      setDebugContext(null);
      setMode("suggestion");
    });
    const unsubscribeSuggestionLoading = window.tab.onSuggestionLoading(setSuggestionLoading);

    const unsubscribeDebugContext = showDeveloperDiagnostics
      ? window.tab.onDebugContext((debug) => {
          setDebugContext(debug);
          setSuggestion(null);
          setMode("debug");
        })
      : () => {};

    const unsubscribeHide = window.tab.onHide(() => {
      setSuggestion(null);
      setSuggestionLoading(false);
      setDebugContext(null);
      setMode("hidden");
    });

    window.tab.overlayReady();

    return () => {
      unsubscribeSuggestion();
      unsubscribeSuggestionLoading();
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
          loading={suggestionLoading}
          onAccept={() => window.tab?.acceptSuggestion()}
        />
      )}
      {showDeveloperDiagnostics ? <DebugContextCard debug={mode === "debug" ? debugContext : null} /> : null}
    </main>
  );
}
