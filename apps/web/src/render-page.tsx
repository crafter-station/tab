import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Avatar,
  AvatarFallback,
  Separator,
  THEME_MODES,
  buttonVariants,
  getThemeControlScript,
  getThemeInitScript,
  type ThemeMode,
} from "@tab/ui";
import { Desktop, Gear, Moon, SignOut, Sun, UserCircle } from "@phosphor-icons/react";
import type { User } from "./components/web-pages.tsx";

const themeInitScript = getThemeInitScript();
const themeControlScript = getThemeControlScript();

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Desktop;
  return <Icon />;
}

function formatThemeModeLabel(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function userAvatarHash(user: User): string {
  const identity = user.email ?? user.id;
  let hash = 0;

  for (const character of identity) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash.toString().padStart(9, "0");
}

function userAvatarUrl(user: User): string {
  return `https://avatar.vercel.sh/${encodeURIComponent(userAvatarHash(user))}`;
}

function StaticThemeMenu() {
  return (
    <details className="group relative" name="header-menu" aria-label="Theme selection">
      <summary className={buttonVariants({ variant: "secondary", size: "icon", className: "cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden" })}>
        <ThemeIcon mode="system" />
      </summary>
      <div className="absolute right-0 z-50 mt-2 min-w-40 rounded-[var(--radius-card)] border border-border bg-popover p-1 text-popover-foreground shadow-[var(--tab-shadow-soft)] [&_svg]:size-4 [&_svg]:shrink-0">
        <div className="px-2 py-1.5 text-sm font-semibold">Theme</div>
        {THEME_MODES.map((mode) => (
          <button className="flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground" data-theme-choice={mode} key={mode} type="button" aria-pressed="false">
            <ThemeIcon mode={mode} />
            {formatThemeModeLabel(mode)}
          </button>
        ))}
      </div>
    </details>
  );
}

function UserMenu({ user }: { user: User }) {
  const userLabel = user.email ?? user.name ?? "Account";

  return (
    <details className="group relative" name="header-menu" aria-label="User menu">
      <summary className={buttonVariants({ variant: "secondary", size: "icon", className: "cursor-pointer list-none rounded-full p-1 marker:hidden [&::-webkit-details-marker]:hidden" })}>
        <Avatar className="size-8">
          <AvatarFallback>{userLabel.slice(0, 1).toUpperCase()}</AvatarFallback>
          <img className="absolute inset-0 size-full" src={userAvatarUrl(user)} alt={`${userLabel} profile picture`} width="32" height="32" loading="lazy" />
        </Avatar>
      </summary>
      <div className="absolute right-0 z-50 mt-2 min-w-56 rounded-[var(--radius-card)] border border-border bg-popover p-1 text-popover-foreground shadow-[var(--tab-shadow-soft)] [&_svg]:size-4 [&_svg]:shrink-0">
        <div className="max-w-56 truncate px-2 py-1.5 text-sm font-semibold">{userLabel}</div>
        <div>
          <a className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground" href="/dashboard">
            <UserCircle />
            Dashboard
          </a>
          <a className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground" href="/dashboard/account">
            <Gear />
            Settings
          </a>
        </div>
        <Separator className="my-1" />
        <form method="post" action="/logout">
          <button className="flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground" type="submit">
            <SignOut />
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}

function WebDocument({
  title,
  children,
  user,
}: {
  title: string;
  children: ReactNode;
  user?: User;
}) {
  return (
    <html lang="en" style={{ colorScheme: "light dark" }}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f7f5f0" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#111111" media="(prefers-color-scheme: dark)" />
        <title>{title}</title>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <a className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:text-foreground focus:shadow-[var(--tab-shadow-soft)]" href="#main-content">Skip to main content</a>
        <div className="pug-grid-surface min-h-dvh px-3 sm:px-5">
          <div className="mx-auto min-h-dvh max-w-6xl border-x border-border/70 bg-background/82 p-4 backdrop-blur-sm sm:p-5">
            <header className="flex items-center justify-between gap-4 border-b border-border/70 pb-4 max-md:flex-col max-md:items-start">
              <a className="font-[var(--font-display)] text-xl font-black tracking-[-0.04em] no-underline" href="/">Tab</a>
              <nav className="flex flex-wrap items-center gap-3 text-sm font-bold">
                <a className="no-underline text-muted-foreground hover:text-foreground" href="/pricing">Pricing</a>
                <a className="no-underline text-muted-foreground hover:text-foreground" href="/download">Download</a>
                <StaticThemeMenu />
                {user ? (
                  <UserMenu user={user} />
                ) : (
                  <a className={buttonVariants({ variant: "secondary" })} href="/login">Sign in</a>
                )}
              </nav>
            </header>
            <main id="main-content" className="py-10 sm:py-12">{children}</main>
            <footer className="flex items-center justify-between gap-4 border-t border-border/70 py-6 text-sm text-muted-foreground max-md:flex-col max-md:items-start">
              <span>Tab, autocomplete for your Mac.</span>
              <span>You choose when to add suggestions, and you control saved memories.</span>
            </footer>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: themeControlScript }} />
      </body>
    </html>
  );
}

export function renderPage(title: string, children: ReactNode, user?: User): string {
  return `<!doctype html>${renderToStaticMarkup(<WebDocument title={title} user={user}>{children}</WebDocument>)}`;
}
