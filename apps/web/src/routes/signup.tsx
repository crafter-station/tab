import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

function SignupPage() {
  return (
    <section className="card" style={{ maxWidth: "34rem" }}>
      <h1>Create your account</h1>
      <form method="post" action="/signup">
        <label>Name<input type="text" name="name" required autoComplete="name" /></label>
        <label>Email<input type="email" name="email" required autoComplete="email" /></label>
        <label>Password<input type="password" name="password" required autoComplete="new-password" /></label>
        <p><button type="submit">Sign up</button></p>
      </form>
      <p className="muted">Already have an account? <a href="/login">Sign in</a>.</p>
    </section>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "signup", component: SignupPage });
