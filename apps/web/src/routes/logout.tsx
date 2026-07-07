import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

function LogoutPage() {
  return (
    <section className="card">
      <h1>Sign out</h1>
      <p>Use the button below to end your Tabb browser session.</p>
      <form method="post" action="/logout"><button type="submit">Sign out</button></form>
    </section>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "logout", component: LogoutPage });
