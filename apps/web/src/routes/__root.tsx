import { HeadContent, Outlet, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router";
import "../styles.css";
import { Button, PLATFORM_COLORS } from "@tab/ui";
import { BrandMenu } from "../components/brand-menu.tsx";
import { SiteFooter, SiteHeader } from "../components/site-shell.tsx";
import { ThemeProvider } from "../components/theme-provider.tsx";
import { UserMenu } from "../components/user-menu.tsx";
import { MessagePage } from "../components/pages/shared.tsx";
import { getViewer } from "../lib/viewer.functions.ts";

function RootComponent() {
  const isDashboard = useRouterState({ select: (state) => state.location.pathname.startsWith("/dashboard") });
  const { viewer } = Route.useLoaderData();

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
                brandControl={<BrandMenu />}
                 accountControl={viewer ? <UserMenu user={viewer} /> : <Button asChild variant="secondary"><a href="/login">Sign in</a></Button>}
                 authenticated={Boolean(viewer)}
              />
              <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 sm:px-8">
                <main id="main-content" className="flex-1 py-8 sm:py-12">
                  <Outlet />
                </main>
              </div>
               <SiteFooter authenticated={Boolean(viewer)} />
            </div>
          )}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

export const rootRoute = createRootRoute({
  loader: async () => ({ viewer: await getViewer() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Tab - Native autocomplete for your Mac" },
      { name: "description", content: "Autocomplete in supported Mac text fields. Automatic Suggestions run locally, and Tab inserts text only when you accept it." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://tab.cueva.io/" },
      { property: "og:title", content: "Tab - Native autocomplete for your Mac" },
      { property: "og:description", content: "Private suggestions and deeper help across the Mac apps where you write." },
      { property: "og:image", content: "https://tab.cueva.io/brand-assets/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Tab - Native autocomplete for your Mac" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://tab.cueva.io/brand-assets/og-image.png" },
    ],
    links: [
      { rel: "icon", href: "/brand-assets/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/brand-assets/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/brand-assets/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/brand-assets/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/brand-assets/site.webmanifest" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: () => <MessagePage title="Not found" message="The page you requested does not exist." />,
  errorComponent: () => <MessagePage title="Something went wrong" message="Tab could not load this page. Please try again." />,
});

export const Route = rootRoute;
