import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import "@tab/ui/styles.css";
import { Button } from "@tab/ui";
import { ThemeModeToggle } from "../components/theme-mode-toggle.tsx";
import { ThemeProvider } from "../components/theme-provider.tsx";

function RootComponent() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f7f5f0" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#111111" media="(prefers-color-scheme: dark)" />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider defaultTheme="system">
          <a className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:text-foreground focus:shadow-[var(--tab-shadow-soft)]" href="#main-content">Skip to main content</a>
          <div className="pug-grid-surface min-h-dvh">
            <div className="mx-auto max-w-6xl border-x border-border/70 bg-background/82 p-5 backdrop-blur-sm">
              <header className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-start">
                <a className="text-xl font-black tracking-[-0.04em] no-underline" href="/">
                  Tab
                </a>
                <nav className="flex flex-wrap items-center gap-3 font-bold">
                  <a className="no-underline" href="/pricing">Pricing</a>
                  <a className="no-underline" href="/download">Download</a>
                  <ThemeModeToggle />
                  <Button asChild variant="secondary">
                    <a href="/login">Sign in</a>
                  </Button>
                </nav>
              </header>
              <main id="main-content" className="py-12">
                <Outlet />
              </main>
              <footer className="flex items-center justify-between gap-4 border-t py-6 text-muted-foreground max-md:flex-col max-md:items-start">
                <span>Tab, native autocomplete for macOS.</span>
                <span>You choose when to add suggestions, and you control saved memories.</span>
              </footer>
            </div>
          </div>
        </ThemeProvider>
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
      { title: "Tab" },
    ],
  }),
  component: RootComponent,
});

export const Route = rootRoute;
