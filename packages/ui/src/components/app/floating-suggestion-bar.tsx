import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export type Suggestion = {
  id: string;
  text: string;
};

type FloatingSuggestionBarProps = {
  suggestion: Suggestion | null;
  source?: "local" | "cloud";
  loading?: boolean;
  onAccept: () => void;
  className?: string;
};

type SuggestionCommandProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  suggestion: ReactNode;
  source?: "local" | "cloud";
  loading?: boolean;
  shortcut?: string;
  shortcutLabel?: string;
};

const shellClassName =
  "absolute inset-0 flex items-center justify-center px-3 py-2";
const visibleShellClassName = "visible";
const hiddenShellClassName = "invisible";

const commandClassName =
  "tab-suggestion-command pointer-events-auto isolate grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--tab-overlay-border)] bg-[var(--tab-overlay-bg)] py-2 pr-2 pl-2.5 text-[var(--tab-overlay-text)] shadow-[var(--tab-overlay-shadow)] backdrop-blur-xl active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tab-overlay-focus-ring)] disabled:pointer-events-none disabled:scale-100";
const iconClassName =
  "tab-suggestion-source relative grid size-6 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] border border-primary bg-primary text-[11px] font-bold text-primary-foreground";
const sourceGlyphClassName =
  "col-start-1 row-start-1 transition-[opacity,transform,filter] duration-200 ease-[var(--tab-ease-out)]";
const shortcutClassName =
  "tab-suggestion-shortcut rounded-[var(--radius-control)] border border-[var(--tab-overlay-divider)] bg-[var(--tab-overlay-key-bg)] px-2 py-1 font-mono text-[11px] font-semibold text-[var(--tab-overlay-muted)] whitespace-nowrap";

export function SuggestionCommand({
  suggestion,
  source,
  loading = false,
  shortcut = "⌥ Tab",
  shortcutLabel = "Option plus Tab",
  className,
  ...props
}: SuggestionCommandProps) {
  const isCloud = source === "cloud";

  return (
    <button
      className={cn(commandClassName, className)}
      data-source={source}
      data-loading={loading || undefined}
      data-suggestion-command
      type="button"
      {...props}
    >
      <span className={cn(iconClassName, loading && "opacity-65")} aria-hidden="true">
        <span
          className={cn(
            sourceGlyphClassName,
            isCloud ? "-translate-y-1 scale-[0.92] opacity-0 blur-[1px]" : "translate-y-0 scale-100 opacity-100 blur-0",
          )}
          data-source-glyph="local"
          data-active={!isCloud || undefined}
        >
          T
        </span>
        <svg
          viewBox="0 0 24 24"
          className={cn(
            sourceGlyphClassName,
            "size-3.5",
            isCloud ? "translate-y-0 scale-100 opacity-100 blur-0" : "translate-y-1 scale-[0.92] opacity-0 blur-[1px]",
          )}
          data-source-glyph="cloud"
          data-active={isCloud || undefined}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M17.5 19H7a5 5 0 0 1-.6-9.96A6.5 6.5 0 0 1 18.82 8.2 4.5 4.5 0 0 1 17.5 19Z" />
        </svg>
      </span>
      <span className={cn(
        "min-w-0 truncate text-left text-[13px] font-medium leading-tight transition-[opacity,filter] duration-150 ease-[var(--tab-ease-out)]",
        loading && "opacity-55 blur-[1px]",
      )}>{suggestion}</span>
      <kbd aria-label={shortcutLabel} className={shortcutClassName}>
        <span aria-hidden="true">{shortcut}</span>
        <span className="sr-only">Option+Tab</span>
      </kbd>
    </button>
  );
}

export function FloatingSuggestionBar({ suggestion, source, loading, onAccept, className }: FloatingSuggestionBarProps) {
  return (
    <section
      className={cn(shellClassName, suggestion ? visibleShellClassName : hiddenShellClassName, className)}
      aria-hidden={!suggestion}
    >
      <SuggestionCommand
        className="w-[min(100%,536px)]"
        onClick={onAccept}
        disabled={!suggestion || loading}
        aria-label={loading
          ? "Generating suggestion"
          : suggestion
            ? `Accept ${source === "cloud" ? "Deep Complete " : ""}suggestion: ${suggestion.text}`
            : "No suggestion available"}
        suggestion={suggestion?.text ?? ""}
        source={source}
        loading={loading}
      />
    </section>
  );
}
