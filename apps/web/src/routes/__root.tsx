import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import "@tabb/ui/styles.css";
import { Button } from "@tabb/ui";

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="mx-auto max-w-6xl p-5">
          <header className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-start">
            <a className="text-xl font-black tracking-[-0.04em] no-underline" href="/">
              Tabb
            </a>
            <nav className="flex flex-wrap items-center gap-3 font-bold">
              <a className="no-underline" href="/pricing">Pricing</a>
              <a className="no-underline" href="/download">Download</a>
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
