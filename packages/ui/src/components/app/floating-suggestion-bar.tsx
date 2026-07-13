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
  "tab-suggestion-source shrink-0 rounded-[var(--radius-control)] border border-primary bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground whitespace-nowrap";
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
      <span className={iconClassName} aria-hidden="true">
        {isCloud ? "Deep Complete" : "Tab"}
      </span>
      <span className="min-w-0 truncate text-left text-[13px] font-medium leading-tight">{suggestion}</span>
      {loading ? (
        <span className={shortcutClassName} role="status">Updating...</span>
      ) : (
        <kbd aria-label={shortcutLabel} className={shortcutClassName}>
          <span aria-hidden="true">{shortcut}</span>
          <span className="sr-only">Option+Tab</span>
        </kbd>
      )}
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
          ? "Updating suggestion"
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
