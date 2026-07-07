import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

function HomePage() {
  return (
    <>
      <section className="hero">
        <div>
          <p className="muted">Native autocomplete for macOS</p>
          <h1>Write faster without changing where you write.</h1>
          <p className="lead">
            Tabb suggests the next few words while you type in Mail, Slack, Notes, Ghostty, and everywhere else you write.
          </p>
          <div className="actions">
            <a className="button" href="/download">
              Download for macOS
            </a>
            <a className="button secondary" href="/pricing">
              See pricing
            </a>
          </div>
        </div>
        <div className="panel">
          <h2>Built for trust</h2>
          <p>Your typing context stays on your Mac. Personal Memory is stored in your account and visible only to you.</p>
          <p>Accept suggestions with Option+Tab or a click when the lightweight overlay appears.</p>
        </div>
      </section>
      <section className="grid" style={{ marginTop: "1rem" }}>
        <article className="card"><h3>Works everywhere</h3><p>Use one native assistant across the apps where you already write.</p></article>
        <article className="card"><h3>Personal Memory</h3><p>Review and delete stored memories from your account dashboard.</p></article>
        <article className="card"><h3>Usage controls</h3><p>Track quota, billing, linked devices, and account status in one place.</p></article>
      </section>
    </>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
