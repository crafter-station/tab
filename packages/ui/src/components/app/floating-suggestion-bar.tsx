import { Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";

export type Suggestion = {
  id: string;
  text: string;
};

type FloatingSuggestionBarProps = {
  suggestion: Suggestion | null;
  onAccept: () => void;
  className?: string;
};

export function FloatingSuggestionBar({ suggestion, onAccept, className }: FloatingSuggestionBarProps) {
  return (
    <section
      className={cn(
        "absolute inset-0 flex items-center justify-center px-4 py-2.5 opacity-0 transition-[opacity,transform] duration-200 ease-[var(--tabb-ease-out)]",
        suggestion ? "translate-y-0 scale-100 opacity-100" : "translate-y-2.5 scale-[0.985]",
        className,
      )}
      aria-hidden={!suggestion}
    >
      <button
        className="pointer-events-auto relative grid min-h-[38px] w-[min(100%,520px)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 overflow-hidden rounded-full border border-border bg-popover/92 py-2 pr-2.5 pl-3 text-popover-foreground shadow-[var(--tabb-glass-shadow)] backdrop-blur-2xl transition-[background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-ring/35 hover:bg-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none"
        type="button"
        onClick={onAccept}
        disabled={!suggestion}
      >
        <span className="pointer-events-none absolute inset-x-10 -top-10 h-14 bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--tabb-signal)_14%,transparent),transparent_70%)] opacity-70" />
        <span className="z-10 inline-flex size-[22px] items-center justify-center rounded-full border border-border bg-secondary text-foreground" aria-hidden="true">
          <Sparkles size={13} strokeWidth={2.2} />
        </span>
        <span className="z-10 truncate text-left text-sm font-medium leading-tight">{suggestion?.text}</span>
        <span className="z-10 rounded-full border border-border bg-secondary px-2 py-1 font-mono text-[10px] font-bold tracking-wide text-muted-foreground whitespace-nowrap">
          Option Tab
        </span>
      </button>
    </section>
  );
}
