import { THEME_MODES, type ThemeMode } from "@tab/ui";
import { useTheme } from "./theme-provider.tsx";

function formatThemeModeLabel(mode: ThemeMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

export function ThemeModeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex rounded-full border bg-card p-1 text-xs text-muted-foreground" aria-label="Theme selection">
      {THEME_MODES.map((mode) => (
        <button
          className="rounded-full px-2 py-1 font-bold transition-colors aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          key={mode}
          type="button"
          aria-pressed={theme === mode}
          onClick={() => setTheme(mode)}
        >
          {formatThemeModeLabel(mode)}
        </button>
      ))}
    </div>
  );
}
