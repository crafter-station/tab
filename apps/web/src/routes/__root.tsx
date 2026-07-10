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
        <meta name="theme-color" content="#f5f4f0" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0d0f0e" media="(prefers-color-scheme: dark)" />
        <HeadContent />
      </head>
      <body className="tab-web">
        <ThemeProvider defaultTheme="system">
          <a className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-control)] focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground" href="#main-content">Skip to main content</a>
          <div className="min-h-dvh">
            <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 sm:px-8">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4 sm:py-5">
                <a className="font-[var(--font-display)] text-xl font-bold tracking-[-0.03em] no-underline" href="/">
                  Tab
                </a>
                <nav className="flex flex-wrap items-center justify-end gap-2 text-sm font-semibold sm:gap-3">
                   <a className="rounded-[var(--radius-control)] px-1.5 py-2 no-underline text-muted-foreground transition-colors duration-150 ease-[var(--tab-ease-out)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/pricing">Pricing</a>
                   <a className="rounded-[var(--radius-control)] px-1.5 py-2 no-underline text-muted-foreground transition-colors duration-150 ease-[var(--tab-ease-out)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/download">Download</a>
                  <ThemeModeToggle />
                  <Button asChild variant="secondary">
                    <a href="/login">Sign in</a>
                  </Button>
                </nav>
              </header>
              <main id="main-content" className="flex-1 py-8 sm:py-12">
                <Outlet />
              </main>
              <footer className="flex items-center justify-between gap-4 border-t py-6 text-sm text-muted-foreground max-md:flex-col max-md:items-start">
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
