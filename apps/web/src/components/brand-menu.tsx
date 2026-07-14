import { Desktop, DownloadSimple, House, Moon, Palette, Sun } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  TabMark,
  cn,
  type ThemeMode,
} from "@tab/ui";
import { useTheme } from "./theme-provider.tsx";

const themeModes = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Desktop },
] as const;

type BrandMenuProps = {
  destinationHref: string;
  destinationLabel: string;
  triggerClassName?: string;
  wordmarkClassName?: string;
};

function BrandLockup({ wordmarkClassName }: { wordmarkClassName?: string }) {
  return (
    <span className="relative flex size-5 shrink-0" aria-hidden="true">
      <TabMark className="size-5 text-primary [&_svg]:!size-full" />
      <span className={cn("absolute left-7 top-0 whitespace-nowrap font-[var(--font-display)] text-sm font-bold tracking-[-0.025em] text-foreground", wordmarkClassName)}>Tab</span>
    </span>
  );
}

function ThemeControls({ theme, onThemeChange }: { theme: ThemeMode; onThemeChange: (mode: ThemeMode) => void }) {
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={(value) => onThemeChange(value as ThemeMode)}>
      <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
      {themeModes.map((mode) => {
        const Icon = mode.icon;
        return (
          <DropdownMenuRadioItem key={mode.id} value={mode.id} data-theme-choice={mode.id}>
            <Icon aria-hidden="true" />
            {mode.label}
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}

export function BrandMenu({
  destinationHref,
  destinationLabel,
  triggerClassName,
  wordmarkClassName,
}: BrandMenuProps) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label="Open Tab brand menu" className={cn("h-10 w-[4.75rem] justify-start px-1.5", triggerClassName)}>
          <BrandLockup wordmarkClassName={wordmarkClassName} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-64 p-2">
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className="py-2.5 font-semibold">
            <a href="/brand/tab-mark.svg" download="tab-mark.svg">
              <DownloadSimple data-icon="inline-start" aria-hidden="true" />
              Download icon only
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="py-2.5 font-semibold">
            <a href="/brand/tab-lockup.svg" download="tab-lockup.svg">
              <DownloadSimple data-icon="inline-start" aria-hidden="true" />
              Download icon + wordmark
            </a>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className="py-2.5 font-semibold">
            <a href="/brand">
              <Palette data-icon="inline-start" aria-hidden="true" />
              Brand guidelines
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="py-2.5 font-semibold">
            <a href={destinationHref}>
              <House data-icon="inline-start" aria-hidden="true" />
              {destinationLabel}
            </a>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <ThemeControls theme={theme} onThemeChange={setTheme} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
