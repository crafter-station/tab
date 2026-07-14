import { Desktop, DownloadSimple, House, Moon, Palette, Sun } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
    <div className="flex items-center justify-between px-2 py-1" aria-label="Theme selection">
      <span className="text-xs font-medium text-muted-foreground">Theme</span>
      <DropdownMenuRadioGroup
        className="flex items-center gap-1"
        value={theme}
        onValueChange={(value) => onThemeChange(value as ThemeMode)}
        aria-label="Theme selection"
      >
        {themeModes.map((mode) => {
          const Icon = mode.icon;
          return (
            <DropdownMenuRadioItem
              key={mode.id}
              value={mode.id}
              data-theme-choice={mode.id}
              aria-label={`${mode.label} theme`}
              title={`${mode.label} theme`}
              className="size-7 justify-center p-0 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&>span]:hidden"
            >
              <Icon aria-hidden="true" />
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </div>
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
        <Button variant="ghost" aria-label="Open Tab brand menu" className={cn("group/brand-menu h-10 w-[4.75rem] justify-start px-1.5 data-[state=open]:bg-[var(--tab-hover)] data-[state=open]:text-foreground", triggerClassName)}>
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
