import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buttonVariants, getThemeControlScript, getThemeInitScript, THEME_MODES } from "@tabb/ui";
import type { User } from "./components/web-pages.tsx";

const themeInitScript = getThemeInitScript();
const themeControlScript = getThemeControlScript();

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
        <link rel="stylesheet" href="/styles.css" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <title>{title}</title>
      </head>
      <body>
        <div className="pug-grid-surface min-h-dvh">
          <div className="mx-auto max-w-6xl border-x border-border/70 bg-background/82 p-5 backdrop-blur-sm">
            <header className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-start">
              <a className="text-xl font-black tracking-[-0.04em] no-underline" href="/">Tabb</a>
              <nav className="flex flex-wrap items-center gap-3 font-bold">
                <a className="no-underline" href="/pricing">Pricing</a>
                <a className="no-underline" href="/download">Download</a>
                <div className="flex rounded-full border bg-card p-1 text-xs text-muted-foreground" aria-label="Theme selection">
                  {THEME_MODES.map((mode) => (
                    <button className="rounded-full px-2 py-1" data-theme-choice={mode} key={mode} type="button">
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
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
            <main className="py-12">{children}</main>
            <footer className="flex items-center justify-between gap-4 border-t py-6 text-muted-foreground max-md:flex-col max-md:items-start">
              <span>Tabb, native autocomplete for macOS.</span>
              <span>Private context. Account-controlled memory.</span>
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
