import { Cloud, LockKey, Option } from "@phosphor-icons/react";
import { SuggestionCommand } from "@tab/ui";
import { useEffect, useRef, useState } from "react";
import { ReplayButton } from "./controls.tsx";
import { useAcceptanceSurface } from "./interaction-provider.tsx";

const deepSuggestions = [
  "I also mapped the rollout risks and key decisions.",
  "The draft includes owners, open questions, and next steps.",
] as const;

export function DeepCompleteDemo() {
  const [phase, setPhase] = useState<"ready" | "requesting" | "accepted">("ready");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("Deep Complete suggestion ready. Press Option plus Tab to accept.");
  const timer = useRef<number | undefined>(undefined);

  const requestDeepComplete = () => {
    window.clearTimeout(timer.current);
    setPhase("requesting");
    setAnnouncement("Deep Complete requested with a double-tap of Option.");
    timer.current = window.setTimeout(() => {
      setSuggestionIndex((current) => (current + 1) % deepSuggestions.length);
      setPhase("ready");
      setAnnouncement("A new Deep Complete suggestion is ready. Press Option plus Tab to accept.");
    }, 420);
  };

  const accept = () => {
    if (phase !== "ready") return;
    window.clearTimeout(timer.current);
    setPhase("accepted");
    setAnnouncement("Deep Complete suggestion accepted.");
    timer.current = window.setTimeout(requestDeepComplete, 900);
  };

  const surface = useAcceptanceSurface<HTMLDivElement>(accept, false, requestDeepComplete);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div
      {...surface}
      className="tab-deep-demo overflow-hidden rounded-[var(--radius-surface)] border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      data-deep-complete-demo
      data-phase={phase}
      role="region"
      aria-label="Interactive Deep Complete example"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
        <div>
          <p className="text-sm font-bold">A harder writing moment</p>
          <p className="text-xs text-muted-foreground">Double-tap Option to explicitly ask for Deep Complete</p>
        </div>
        <ReplayButton label="Request another Deep Complete" onReplay={requestDeepComplete} />
      </div>

      <div className="tab-deep-canvas grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_12rem] md:p-8 lg:gap-8 lg:p-10">
        <div className="grid min-h-72 content-between gap-8 rounded-[var(--radius-card)] border border-border bg-background p-4 shadow-[var(--tab-shadow-card)] sm:p-5">
          <div>
            <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex items-center gap-2 text-sm font-bold"><span className="size-2 rounded-full bg-[var(--success)]" /> Mail</div>
              <span className="inline-flex items-center gap-1.5 font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground"><LockKey aria-hidden="true" /> Bounded context</span>
            </div>
            <p className="mt-5 text-lg leading-8">Hi Maya,</p>
            <p className="mt-3 text-lg leading-8">I pulled the launch plan together.</p>
            <p className="tab-deep-draft-suggestion mt-3 text-lg leading-8 text-muted-foreground">{deepSuggestions[suggestionIndex]}</p>
          </div>

          <SuggestionCommand
            aria-label="Accept the Deep Complete suggestion with Option plus Tab"
            className="tab-deep-overlay"
            data-deep-accept
            disabled={phase !== "ready"}
            onClick={accept}
            refreshing={phase === "requesting"}
            source="cloud"
            suggestion={deepSuggestions[suggestionIndex]}
          />
        </div>

        <div className="grid content-center justify-items-center gap-5 text-center">
          <button className="tab-deep-trigger rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" onClick={requestDeepComplete} aria-label="Request Deep Complete by double-tapping Option">
            <span className="flex gap-2" aria-hidden="true">
              <kbd className="tab-deep-key"><Option /></kbd>
              <kbd className="tab-deep-key tab-deep-key-second"><Option /></kbd>
            </span>
          </button>
          <div>
            <p className="font-[var(--font-code)] text-[0.625rem] font-semibold uppercase text-muted-foreground">Double-tap Option</p>
            <p className="mt-2 text-sm font-semibold">Request, then accept</p>
          </div>
          <div className="h-10 w-px bg-border" aria-hidden="true"><span className="tab-deep-signal block size-2 -translate-x-[0.21875rem] rounded-full bg-[var(--tab-overlay-deep-accent)]" /></div>
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Cloud aria-hidden="true" /> Explicit cloud path</span>
        </div>
      </div>
      <p className="sr-only" aria-live="polite" data-deep-announcement>{announcement}</p>
    </div>
  );
}
