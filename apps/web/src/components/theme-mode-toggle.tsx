import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  THEME_MODES,
  type ThemeMode,
} from "@tab/ui";
import { Check, Desktop, Moon, Sun } from "@phosphor-icons/react";
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
          <ActiveIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuGroup>
          {THEME_MODES.map((mode) => {
            const Icon = themeIcons[mode];
            const selected = theme === mode;

            return (
              <DropdownMenuItem key={mode} onClick={() => setTheme(mode)} aria-pressed={selected}>
                <Icon />
                {formatThemeModeLabel(mode)}
                {selected ? <Check className="ml-auto" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
