import type { ReactNode } from "react";
import { ArrowUpRight, List, X } from "@phosphor-icons/react";

const primaryLinks = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/download", label: "Download" },
] as const;

const baseFooterGroups = [
  {
    label: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/download", label: "Download" },
      { href: "/login", label: "Sign in" },
    ],
  },
  {
    label: "Company",
    links: [
      { href: "/about", label: "About" },
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
    <a className="group inline-flex items-center gap-2.5 no-underline" href="/" aria-label="Tab home">
      <span className="grid size-8 place-items-center rounded-[var(--radius-media)] border border-foreground bg-foreground font-[var(--font-code)] text-sm font-bold text-background transition-transform duration-150 ease-[var(--tab-ease-out)] group-active:scale-[0.97]" aria-hidden="true">T</span>
      <span className="font-[var(--font-display)] text-lg font-bold tracking-[-0.035em]">Tab</span>
    </a>
  );
}

export function SiteHeader({
  themeControl,
  accountControl,
}: {
  themeControl: ReactNode;
  accountControl: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Brand />
        <div className="flex items-center gap-2">
          <nav className="hidden items-center gap-1 text-sm font-semibold md:flex" aria-label="Primary navigation">
            {primaryLinks.map((link) => (
              <a className="rounded-[var(--radius-control)] px-3 py-2 text-muted-foreground no-underline transition-colors duration-150 ease-[var(--tab-ease-out)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={link.href} key={link.href}>{link.label}</a>
            ))}
          </nav>
          <details className="group relative md:hidden" name="site-menu">
            <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-[var(--radius-control)] border border-border bg-secondary text-secondary-foreground transition-[background-color,transform] duration-150 ease-[var(--tab-ease-out)] marker:hidden active:scale-[0.97] [&::-webkit-details-marker]:hidden" aria-label="Open navigation">
              <List className="group-open:hidden" aria-hidden="true" />
              <X className="hidden group-open:block" aria-hidden="true" />
            </summary>
            <nav className="tab-disclosure-panel absolute right-0 mt-2 grid min-w-52 rounded-[var(--radius-card)] border border-border bg-popover p-1 text-sm font-semibold text-popover-foreground shadow-[0_18px_50px_rgba(0,0,0,0.12)]" aria-label="Mobile navigation">
              {primaryLinks.map((link) => (
                <a className="rounded-[var(--radius-control)] px-3 py-2.5 no-underline transition-colors duration-150 ease-[var(--tab-ease-out)] hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={link.href} key={link.href}>{link.label}</a>
              ))}
            </nav>
          </details>
          {themeControl}
          {accountControl}
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
            <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">Native autocomplete that helps you finish the thought in the Mac apps where you already write.</p>
            <a className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold underline decoration-border underline-offset-4 transition-colors duration-150 hover:decoration-foreground" href="mailto:tab@cueva.io">
              tab@cueva.io
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {footerGroups(authenticated).map((group) => (
              <div key={group.label}>
                <p className="font-[var(--font-code)] text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</p>
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
        <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Crafter Station. All rights reserved.</p>
          <p>Made for macOS. You choose what Tab adds.</p>
        </div>
      </div>
    </footer>
  );
}
