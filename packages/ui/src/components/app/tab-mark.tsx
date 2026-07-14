import { cn } from "../../lib/utils";

export function TabMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-tab-mark="continuation-gap"
      className={cn(
        "grid size-8 shrink-0 place-items-center text-primary",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-full" focusable="false">
        <path fill="currentColor" d="M1 8h10.8l-2.2 8H1Z" />
        <path fill="currentColor" d="M14.4 8H23v8H12.2Z" />
      </svg>
    </span>
  );
}
