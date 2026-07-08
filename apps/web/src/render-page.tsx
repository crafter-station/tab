import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { THEME_MODES, buttonVariants, getThemeControlScript, getThemeInitScript } from "@tab/ui";
import type { User } from "./components/web-pages.tsx";

const themeInitScript = getThemeInitScript();
const themeControlScript = getThemeControlScript();

function formatThemeModeLabel(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
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
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div className="pug-grid-surface min-h-dvh px-3 sm:px-5">
          <div className="mx-auto min-h-dvh max-w-6xl border-x border-border/70 bg-background/82 p-4 backdrop-blur-sm sm:p-5">
            <header className="flex items-center justify-between gap-4 border-b border-border/70 pb-4 max-md:flex-col max-md:items-start">
              <a className="font-[var(--font-display)] text-xl font-black tracking-[-0.04em] no-underline" href="/">Tab</a>
              <nav className="flex flex-wrap items-center gap-3 text-sm font-bold">
                <a className="no-underline text-muted-foreground hover:text-foreground" href="/pricing">Pricing</a>
                <a className="no-underline text-muted-foreground hover:text-foreground" href="/download">Download</a>
                <div className="flex rounded-full border bg-card p-1 text-xs text-muted-foreground" aria-label="Theme selection">
                  {THEME_MODES.map((mode) => (
                    <button className="rounded-full px-2 py-1 font-bold" data-theme-choice={mode} key={mode} type="button">
                      {formatThemeModeLabel(mode)}
                    </button>
                  ))}
                </div>
                {user ? (
                  <a className={buttonVariants({ variant: "secondary" })} href="/dashboard">Dashboard</a>
                ) : (
                  <a className={buttonVariants({ variant: "secondary" })} href="/login">Sign in</a>
                )}
              </nav>
            </header>
            <main className="py-10 sm:py-12">{children}</main>
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
