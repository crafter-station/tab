import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      <p className="lead">Manage account configuration, usage, billing, devices, permissions, and Personal Memory.</p>
      <div className="dashboard-grid">
        <section className="card"><h2>Monthly usage</h2><p>Plan, quota, and reset dates load from the Tabb API when you are signed in.</p><p><a className="button secondary" href="/billing/portal">Manage billing</a></p></section>
        <section className="card"><h2>Account</h2><p>Identity and safe account settings appear here without inventing unsupported settings APIs.</p></section>
        <section className="card" id="devices"><h2>Devices</h2><p>Linked native devices, versions, status, and revoke controls are powered by the existing device APIs.</p></section>
        <section className="card" id="memories"><h2>Personal Memory</h2><p>Review and delete memories collected for autocomplete personalization.</p></section>
      </div>
    </>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "dashboard", component: DashboardPage });
