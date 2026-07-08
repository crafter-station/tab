import { FloatingSuggestionBar, type Suggestion } from "@tab/ui";
import { useEffect, useState } from "react";
import { DebugContextCard, type DebugContext } from "../components/DebugContextCard";

type OverlayMode = "hidden" | "suggestion" | "debug";
const showDeveloperDiagnostics = import.meta.env.DEV;

export function OverlaySurface() {
  const [mode, setMode] = useState<OverlayMode>("hidden");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [debugContext, setDebugContext] = useState<DebugContext | null>(null);

  useEffect(() => {
    if (!window.tab) return;

    const unsubscribeSuggestion = window.tab.onSuggestion((nextSuggestion) => {
      setSuggestion(nextSuggestion);
      setDebugContext(null);
      setMode("suggestion");
    });

    const unsubscribeDebugContext = showDeveloperDiagnostics
      ? window.tab.onDebugContext((debug) => {
          setDebugContext(debug);
          setSuggestion(null);
          setMode("debug");
        })
      : () => {};

    const unsubscribeHide = window.tab.onHide(() => {
      setSuggestion(null);
      setDebugContext(null);
      setMode("hidden");
    });

    window.tab.overlayReady();

    return () => {
      unsubscribeSuggestion();
      unsubscribeDebugContext();
      unsubscribeHide();
    };
  }, []);

  return (
    <main className="overlay-shell" data-mode={mode}>
      <FloatingSuggestionBar
        suggestion={mode === "suggestion" ? suggestion : null}
        onAccept={() => window.tab?.acceptSuggestion()}
      />
      {showDeveloperDiagnostics ? <DebugContextCard debug={mode === "debug" ? debugContext : null} /> : null}
    </main>
  );
}
