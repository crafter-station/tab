import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import "../styles.css";

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="shell">
          <header className="site-header">
            <a className="brand" href="/">
              Tabb
            </a>
            <nav>
              <a href="/pricing">Pricing</a>
              <a href="/download">Download</a>
              <a className="button secondary" href="/login">
                Sign in
              </a>
            </nav>
          </header>
          <main>
            <Outlet />
          </main>
          <footer className="site-footer">
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
