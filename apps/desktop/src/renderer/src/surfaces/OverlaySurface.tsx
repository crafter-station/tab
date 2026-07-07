import { FloatingSuggestionBar, type Suggestion } from "@tabb/ui";
import { useEffect, useState } from "react";
import { DebugContextCard, type DebugContext } from "../components/DebugContextCard";

type OverlayMode = "hidden" | "suggestion" | "debug";

export function OverlaySurface() {
  const [mode, setMode] = useState<OverlayMode>("hidden");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [debugContext, setDebugContext] = useState<DebugContext | null>(null);

  useEffect(() => {
    if (!window.tabb) return;

    const unsubscribeSuggestion = window.tabb.onSuggestion((nextSuggestion) => {
      setSuggestion(nextSuggestion);
      setDebugContext(null);
      setMode("suggestion");
    });

    const unsubscribeDebugContext = window.tabb.onDebugContext((debug) => {
      setDebugContext(debug);
      setSuggestion(null);
      setMode("debug");
    });

    const unsubscribeHide = window.tabb.onHide(() => {
      setSuggestion(null);
      setDebugContext(null);
      setMode("hidden");
    });

    window.tabb.overlayReady();

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
        onAccept={() => window.tabb?.acceptSuggestion()}
      />
      <DebugContextCard debug={mode === "debug" ? debugContext : null} />
    </main>
  );
}
