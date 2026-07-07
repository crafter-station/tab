import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buttonVariants } from "@tabb/ui";

function WebDocument({ title, children }: { title: string; children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/styles.css" />
        <title>{title}</title>
      </head>
      <body>
        <div className="mx-auto max-w-6xl p-5">
          <header className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-start">
            <a className="text-xl font-black tracking-[-0.04em] no-underline" href="/">Tabb</a>
            <nav className="flex flex-wrap items-center gap-3 font-bold">
              <a className="no-underline" href="/pricing">Pricing</a>
              <a className="no-underline" href="/download">Download</a>
              <a className={buttonVariants({ variant: "secondary" })} href="/login">Sign in</a>
            </nav>
          </header>
          <main className="py-12">{children}</main>
          <footer className="flex items-center justify-between gap-4 border-t py-6 text-muted-foreground max-md:flex-col max-md:items-start">
            <span>Tabb, native autocomplete for macOS.</span>
            <span>Private context. Account-controlled memory.</span>
          </footer>
        </div>
      </body>
    </html>
  );
}

export function renderPage(title: string, children: ReactNode): string {
  return `<!doctype html>${renderToStaticMarkup(<WebDocument title={title}>{children}</WebDocument>)}`;
}
