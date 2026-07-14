import { Desktop, DownloadSimple, House, Moon, Palette, Sun } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
  TabMark,
  buttonVariants,
  cn,
  type ThemeMode,
} from "@tab/ui";
import { useTheme } from "./theme-provider.tsx";

const themeModes = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Desktop },
] as const;

const staticMenuItemClass = "flex items-center gap-3 rounded-sm px-2 py-2.5 text-sm font-semibold text-popover-foreground no-underline outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground";

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

function ThemeControls({ theme, onThemeChange }: { theme?: ThemeMode; onThemeChange?: (mode: ThemeMode) => void }) {
  return (
    <div className="flex items-center justify-between px-2 py-1" aria-label="Theme selection">
      <span className="text-xs font-medium text-muted-foreground">Theme</span>
      <div className="flex items-center gap-1">
        {themeModes.map((mode) => {
          const Icon = mode.icon;
          return (
            <button
              key={mode.id}
              type="button"
              data-theme-choice={mode.id}
              aria-pressed={theme === mode.id}
              aria-label={`${mode.label} theme`}
              className="grid size-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground transition-colors duration-150 ease-[var(--tab-ease-out)] hover:bg-accent hover:text-accent-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              onClick={() => onThemeChange?.(mode.id)}
            >
              <Icon className="size-3.5" aria-hidden="true" />
            </button>
          );
        })}
      </div>
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

export function StaticBrandMenu({
  destinationHref,
  destinationLabel,
  triggerClassName,
  wordmarkClassName,
}: BrandMenuProps) {
  return (
    <details className="dashboard-brand-menu group relative" name="header-menu">
      <summary
        aria-label="Open Tab brand menu"
        className={buttonVariants({
          variant: "ghost",
          className: cn("h-10 w-[4.75rem] list-none justify-start overflow-hidden px-1.5 marker:hidden [&::-webkit-details-marker]:hidden", triggerClassName),
        })}
      >
        <BrandLockup wordmarkClassName={wordmarkClassName} />
      </summary>
      <div className="dashboard-brand-menu-panel tab-disclosure-panel absolute left-0 z-50 mt-2 grid w-64 gap-1 rounded-[var(--radius-card)] border border-border bg-popover p-2 text-popover-foreground shadow-[var(--tab-shadow-card)]">
        <a href="/brand/tab-mark.svg" download="tab-mark.svg" className={staticMenuItemClass}>
          <DownloadSimple className="size-4" aria-hidden="true" />
          Download icon only
        </a>
        <a href="/brand/tab-lockup.svg" download="tab-lockup.svg" className={staticMenuItemClass}>
          <DownloadSimple className="size-4" aria-hidden="true" />
          Download icon + wordmark
        </a>
        <Separator className="my-1" />
        <a href="/brand" className={staticMenuItemClass}>
          <Palette className="size-4" aria-hidden="true" />
          Brand guidelines
        </a>
        <a href={destinationHref} className={staticMenuItemClass}>
          <House className="size-4" aria-hidden="true" />
          {destinationLabel}
        </a>
        <Separator className="my-1" />
        <ThemeControls />
      </div>
    </details>
  );
}
