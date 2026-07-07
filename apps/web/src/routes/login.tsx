import { createRoute, useSearch } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

function LoginPage() {
  const search = useSearch({ strict: false }) as { device_id?: string; callback?: string };

  return (
    <section className="card" style={{ maxWidth: "34rem" }}>
      <h1>Sign in</h1>
      <form method="post" action="/login">
        {search.device_id ? <input type="hidden" name="device_id" value={search.device_id} /> : null}
        {search.callback ? <input type="hidden" name="callback" value={search.callback} /> : null}
        <label>Email<input type="email" name="email" required autoComplete="email" /></label>
        <label>Password<input type="password" name="password" required autoComplete="current-password" /></label>
        <p><button type="submit">Sign in</button></p>
      </form>
      <p className="muted">Need an account? <a href="/signup">Create one</a>.</p>
    </section>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "login", component: LoginPage });
