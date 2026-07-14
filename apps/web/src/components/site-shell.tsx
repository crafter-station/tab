import type { ReactNode } from "react";
import { ArrowUpRight, CaretDown, Desktop, List, Moon, Sun } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  TabMark,
  type ThemeMode,
} from "@tab/ui";
import { useTheme } from "./theme-provider.tsx";

const primaryLinks = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
] as const;

const secondaryLinks = [
  { href: "/download", label: "Download" },
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/contact", label: "Contact" },
] as const;

const mobileLinks = [...primaryLinks, ...secondaryLinks] as const;

const themeModes = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Desktop },
] as const;

const baseFooterGroups = [
  {
    label: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/download", label: "Download" },
      { href: "/login", label: "Sign in" },
    ],
  },
  {
    label: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/brand", label: "Brand" },
      { href: "/contact", label: "Contact" },
      { href: "https://github.com/crafter-station/tab", label: "GitHub", external: true },
    ],
  },
  {
    label: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
] as const;

function footerGroups(authenticated: boolean) {
  if (!authenticated) return baseFooterGroups;
  return baseFooterGroups.map((group) => group.label === "Product"
    ? { ...group, links: group.links.map((link) => link.href === "/login" ? { href: "/dashboard", label: "Dashboard" } : link) }
    : group);
}

function Brand() {
  return (
    <a className="group inline-flex items-center gap-2 no-underline" href="/" aria-label="Tab home">
      <TabMark className="size-7 transition-transform duration-150 ease-[var(--tab-ease-out)] group-active:scale-[0.97]" />
      <span className="font-[var(--font-display)] text-base font-bold">Tab</span>
    </a>
  );
}

function FooterThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-0.5 rounded-[var(--radius-control)] border border-border bg-muted/40 p-0.5" role="group" aria-label="Theme">
      {themeModes.map((mode) => {
        const Icon = mode.icon;
        return (
          <Button
            key={mode.id}
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-[var(--tab-shadow-control)]"
            aria-label={`${mode.label} theme`}
            aria-pressed={theme === mode.id}
            title={`${mode.label} theme`}
            onClick={() => setTheme(mode.id as ThemeMode)}
          >
            <Icon aria-hidden="true" />
          </Button>
        );
      })}
    </div>
  );
}

export function SiteHeader({
  brandControl,
  accountControl,
  authenticated = false,
}: {
  brandControl: ReactNode;
  accountControl: ReactNode;
  authenticated?: boolean;
}) {
  const downloadControl = <Button asChild size="sm" className="max-lg:hidden"><a href="/download/tab.dmg">Download for Mac</a></Button>;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        {brandControl}
        <div className="flex items-center gap-1.5">
          <nav className="mr-1 hidden items-center gap-0.5 text-[13px] font-semibold lg:flex" aria-label="Primary navigation">
            {primaryLinks.map((link) => (
              <a className="rounded-[var(--radius-control)] px-2.5 py-2 text-muted-foreground no-underline transition-colors duration-150 ease-[var(--tab-ease-out)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={link.href} key={link.href}>{link.label}</a>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  More
                  <CaretDown data-icon="inline-end" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuGroup>
                  {secondaryLinks.map((link) => (
                    <DropdownMenuItem asChild key={link.href}>
                      <a href={link.href}>{link.label}</a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
          {authenticated ? downloadControl : accountControl}
          {authenticated ? accountControl : downloadControl}
          <Sheet>
            <SheetTrigger asChild>
              <Button className="lg:hidden" variant="secondary" size="icon" aria-label="Open navigation">
                <List aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex flex-col">
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>Browse Tab product and company pages.</SheetDescription>
              </SheetHeader>
              <nav className="grid gap-1 text-sm font-semibold" aria-label="Mobile navigation">
                {mobileLinks.map((link) => (
                  <SheetClose asChild key={link.href}>
                    <a className="rounded-[var(--radius-control)] px-3 py-2.5 no-underline hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={link.href}>{link.label}</a>
                  </SheetClose>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ authenticated = false }: { authenticated?: boolean }) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="max-w-sm">
            <Brand />
            <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">Autocomplete in supported Mac text fields. Nothing is inserted until you accept it.</p>
            <a className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold underline decoration-border underline-offset-4 transition-colors duration-150 hover:decoration-foreground" href="mailto:tab@cueva.io">
              tab@cueva.io
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {footerGroups(authenticated).map((group) => (
              <div key={group.label}>
                <p className="font-[var(--font-code)] text-xs font-semibold uppercase text-muted-foreground">{group.label}</p>
                <ul className="mt-4 grid gap-3 text-sm font-medium">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <a className="inline-flex items-center gap-1 text-foreground/80 no-underline transition-colors duration-150 hover:text-foreground" href={link.href} {...("external" in link ? { target: "_blank", rel: "noreferrer" } : {})}>
                        {link.label}
                        {"external" in link ? <ArrowUpRight aria-hidden="true" /> : null}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          <div className="flex justify-end">
            <FooterThemeToggle />
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} Crafter Station. All rights reserved.</p>
            <p>Made for macOS. You choose what Tab adds.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
