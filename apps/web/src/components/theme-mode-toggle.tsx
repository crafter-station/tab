import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  THEME_MODES,
  type ThemeMode,
} from "@tab/ui";
import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { useTheme } from "./theme-provider.tsx";

const themeIcons: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Desktop,
};

function formatThemeModeLabel(mode: ThemeMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

export function ThemeModeToggle() {
  const { theme, setTheme } = useTheme();
  const ActiveIcon = themeIcons[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" aria-label={`Theme selection: ${formatThemeModeLabel(theme)}`}>
          <ActiveIcon data-icon="only" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeMode)}>
          {THEME_MODES.map((mode) => {
            const Icon = themeIcons[mode];

            return (
              <DropdownMenuRadioItem key={mode} value={mode}>
                <Icon data-icon="inline-start" />
                {formatThemeModeLabel(mode)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
