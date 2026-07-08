import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import "@tabb/ui/styles.css";
import { Button, getThemeInitScript } from "@tabb/ui";

const themeControlScript = `${getThemeInitScript()} document.addEventListener('click', function(event) { var target = event.target instanceof Element ? event.target.closest('[data-theme-choice]') : null; if (!target) return; var mode = target.getAttribute('data-theme-choice') || 'system'; try { localStorage.setItem('tabb-theme', mode); var dark = mode === 'dark' || (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.documentElement.classList.toggle('dark', dark); } catch (_) {} });`;

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
      </head>
      <body>
        <div className="pug-grid-surface min-h-dvh">
          <div className="mx-auto max-w-6xl border-x border-border/70 bg-background/82 p-5 backdrop-blur-sm">
            <header className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-start">
              <a className="text-xl font-black tracking-[-0.04em] no-underline" href="/">
                Tabb
              </a>
              <nav className="flex flex-wrap items-center gap-3 font-bold">
                <a className="no-underline" href="/pricing">Pricing</a>
                <a className="no-underline" href="/download">Download</a>
                <div className="flex rounded-full border bg-card p-1 text-xs text-muted-foreground" aria-label="Theme selection">
                  <button className="rounded-full px-2 py-1" data-theme-choice="system" type="button">System</button>
                  <button className="rounded-full px-2 py-1" data-theme-choice="light" type="button">Light</button>
                  <button className="rounded-full px-2 py-1" data-theme-choice="dark" type="button">Dark</button>
                </div>
                <Button asChild variant="secondary">
                  <a href="/login">Sign in</a>
                </Button>
              </nav>
            </header>
            <main className="py-12">
              <Outlet />
            </main>
            <footer className="flex items-center justify-between gap-4 border-t py-6 text-muted-foreground max-md:flex-col max-md:items-start">
              <span>Tabb, native autocomplete for macOS.</span>
              <span>Private context. Account-controlled memory.</span>
            </footer>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: themeControlScript }} />
        <Scripts />
      </body>
    </html>
  );
}

export const rootRoute = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Tabb" },
    ],
  }),
  component: RootComponent,
});

export const Route = rootRoute;
