import { useEffect, useState } from "react";
import { DebugContextCard, type DebugContext } from "./components/DebugContextCard";
import { FloatingSuggestionBar, type Suggestion } from "./components/FloatingSuggestionBar";

type OverlayMode = "hidden" | "suggestion" | "debug";

export function App() {
  const [mode, setMode] = useState<OverlayMode>("hidden");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [debugContext, setDebugContext] = useState<DebugContext | null>(null);

  useEffect(() => {
    if (!window.tabb) return;

    window.tabb.onSuggestion((nextSuggestion) => {
      setSuggestion(nextSuggestion);
      setDebugContext(null);
      setMode("suggestion");
    });

    window.tabb.onDebugContext((debug) => {
      setDebugContext(debug);
      setSuggestion(null);
      setMode("debug");
    });

    window.tabb.onHide(() => {
      setSuggestion(null);
      setDebugContext(null);
      setMode("hidden");
    });
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
