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

const shellClassName =
  "absolute inset-0 flex items-center justify-center px-3 py-2 opacity-0";
const visibleShellClassName = "opacity-100";
const hiddenShellClassName = "opacity-0";

const buttonClassName =
  "pointer-events-auto grid min-h-11 w-[min(100%,536px)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--tab-overlay-border)] bg-[var(--tab-overlay-bg)] py-2 pr-2 pl-2.5 text-[var(--tab-overlay-text)] shadow-[var(--tab-overlay-shadow)] backdrop-blur-xl transition-transform duration-100 ease-[var(--tab-ease-out)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:pointer-events-none disabled:scale-100";
const iconClassName =
  "inline-flex size-6 items-center justify-center rounded-[var(--radius-control)] bg-[var(--tab-overlay-key-bg)] text-[11px] font-bold text-[var(--tab-overlay-text)]";
const shortcutClassName =
  "rounded-[var(--radius-control)] border border-[var(--tab-overlay-divider)] bg-[var(--tab-overlay-key-bg)] px-2 py-1 font-mono text-[11px] font-semibold text-[var(--tab-overlay-muted)] whitespace-nowrap";

export function FloatingSuggestionBar({ suggestion, onAccept, className }: FloatingSuggestionBarProps) {
  return (
    <section
      className={cn(shellClassName, suggestion ? visibleShellClassName : hiddenShellClassName, className)}
      aria-hidden={!suggestion}
    >
      <button
        className={buttonClassName}
        type="button"
        onClick={onAccept}
        disabled={!suggestion}
        aria-label={suggestion ? `Accept suggestion: ${suggestion.text}` : "No suggestion available"}
      >
        <span className={iconClassName} aria-hidden="true">
          T
        </span>
        <span className="truncate text-left text-[13px] font-medium leading-tight">{suggestion?.text}</span>
        <kbd aria-label="Option plus Tab" className={shortcutClassName}>
          <span aria-hidden="true">⌥ Tab</span>
          <span className="sr-only">Option+Tab</span>
        </kbd>
      </button>
    </section>
  );
}
