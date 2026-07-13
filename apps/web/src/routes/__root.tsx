import { HeadContent, Outlet, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router";
import "../styles.css";
import { Button, PLATFORM_COLORS } from "@tab/ui";
import { SiteFooter, SiteHeader } from "../components/site-shell.tsx";
import { ThemeModeToggle } from "../components/theme-mode-toggle.tsx";
import { ThemeProvider } from "../components/theme-provider.tsx";

function RootComponent() {
  const isDashboard = useRouterState({ select: (state) => state.location.pathname.startsWith("/dashboard") });

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content={PLATFORM_COLORS.theme.light.background} media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content={PLATFORM_COLORS.theme.dark.background} media="(prefers-color-scheme: dark)" />
        <HeadContent />
      </head>
      <body className="tab-web">
        <ThemeProvider defaultTheme="system">
          <a className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-control)] focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground" href="#main-content">Skip to main content</a>
          {isDashboard ? <Outlet /> : (
            <div className="flex min-h-dvh flex-col">
              <SiteHeader
                themeControl={<ThemeModeToggle />}
                accountControl={<Button asChild variant="secondary"><a href="/login">Sign in</a></Button>}
              />
              <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 sm:px-8">
                <main id="main-content" className="flex-1 py-8 sm:py-12">
                  <Outlet />
                </main>
              </div>
              <SiteFooter />
            </div>
          )}
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
      { title: "Tab - Native autocomplete for your Mac" },
      { name: "description", content: "Autocomplete in supported Mac text fields. Automatic Suggestions run locally, and Tab inserts text only when you accept it." },
    ],
  }),
  component: RootComponent,
});

export const Route = rootRoute;
