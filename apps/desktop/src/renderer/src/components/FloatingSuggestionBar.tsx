import { Sparkles } from "lucide-react";
import { cn } from "../lib/utils";

export type Suggestion = {
  id: string;
  text: string;
};

type FloatingSuggestionBarProps = {
  suggestion: Suggestion | null;
  onAccept: () => void;
};

export function FloatingSuggestionBar({ suggestion, onAccept }: FloatingSuggestionBarProps) {
  return (
    <section className={cn("suggestion-stage", suggestion && "suggestion-stage--visible")} aria-hidden={!suggestion}>
      <button className="suggestion-pill" type="button" onClick={onAccept} disabled={!suggestion}>
        <span className="suggestion-pill__glow" />
        <span className="suggestion-pill__icon" aria-hidden="true">
          <Sparkles size={13} strokeWidth={2.2} />
        </span>
        <span className="suggestion-pill__text">{suggestion?.text}</span>
        <span className="suggestion-pill__hint">Option Tab</span>
      </button>
    </section>
  );
}
