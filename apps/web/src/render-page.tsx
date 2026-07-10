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
import type { User } from "./components/pages/shared.tsx";
import { SiteFooter, SiteHeader } from "./components/site-shell.tsx";

const themeInitScript = getThemeInitScript();
const themeControlScript = getThemeControlScript();

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Desktop;
  return <Icon aria-hidden="true" />;
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
      <summary className={buttonVariants({ variant: "secondary", size: "icon", className: "list-none marker:hidden [&::-webkit-details-marker]:hidden" })}>
        <ThemeIcon mode="system" />
        <span className="sr-only">Choose theme</span>
      </summary>
      <div className="tab-disclosure-panel absolute right-0 z-50 mt-2 min-w-40 rounded-[var(--radius-card)] border border-border bg-popover p-1 text-popover-foreground [&_svg]:size-4 [&_svg]:shrink-0">
        <div className="px-2 py-1.5 text-sm font-semibold">Theme</div>
        {THEME_MODES.map((mode) => (
          <button className="flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground" data-theme-choice={mode} key={mode} type="button" aria-pressed="false">
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
      <summary className={buttonVariants({ variant: "secondary", size: "icon", className: "list-none rounded-full p-1 marker:hidden [&::-webkit-details-marker]:hidden" })}>
        <Avatar className="size-8">
          <AvatarFallback>{userLabel.slice(0, 1).toUpperCase()}</AvatarFallback>
          <img className="absolute inset-0 size-full" src={userAvatarUrl(user)} alt={`${userLabel} profile picture`} width="32" height="32" loading="lazy" />
        </Avatar>
      </summary>
      <div className="tab-disclosure-panel absolute right-0 z-50 mt-2 min-w-56 rounded-[var(--radius-card)] border border-border bg-popover p-1 text-popover-foreground [&_svg]:size-4 [&_svg]:shrink-0">
        <div className="max-w-56 truncate px-2 py-1.5 text-sm font-semibold">{userLabel}</div>
        <div>
          <a className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground" href="/dashboard">
            <UserCircle />
            Dashboard
          </a>
          <a className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground" href="/dashboard/account">
            <Gear />
            Settings
          </a>
        </div>
        <Separator className="my-1" />
        <form method="post" action="/logout">
          <button className="flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground" type="submit">
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
  description,
  children,
  user,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  user?: User;
}) {
  const pageDescription = description ?? "Finish thoughts faster in the Mac apps where you already write. Tab only inserts a suggestion when you choose.";

  return (
    <html lang="en" style={{ colorScheme: "light dark" }}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f2f3f0" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#171917" media="(prefers-color-scheme: dark)" />
        <meta name="description" content={pageDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={pageDescription} />
        <meta name="twitter:card" content="summary" />
        <title>{title}</title>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body className="tab-web">
        <a className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-control)] focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground" href="#main-content">Skip to main content</a>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader
            themeControl={<StaticThemeMenu />}
            accountControl={user ? <UserMenu user={user} /> : <a className={buttonVariants({ variant: "secondary" })} href="/login">Sign in</a>}
          />
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 sm:px-8">
            <main id="main-content" className="flex-1 py-8 sm:py-12">{children}</main>
          </div>
          <SiteFooter authenticated={Boolean(user)} />
        </div>
        <script dangerouslySetInnerHTML={{ __html: themeControlScript }} />
      </body>
    </html>
  );
}

export function renderPage(title: string, children: ReactNode, user?: User, description?: string): string {
  return `<!doctype html>${renderToStaticMarkup(<WebDocument title={title} user={user} description={description}>{children}</WebDocument>)}`;
}
