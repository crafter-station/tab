import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./__root.tsx";

function DownloadPage() {
  return (
    <section className="hero">
      <div>
        <h1>Download Tabb for macOS</h1>
        <p className="lead">Install the native autocomplete app directly on your Mac.</p>
        <p><a className="button" href="/download/tabb.dmg">Download Tabb.dmg</a></p>
      </div>
      <div className="panel">
        <h2>Before you start</h2>
        <p>Tabb requires macOS Accessibility permission to show and accept inline suggestions.</p>
        <p className="muted">macOS 14+. Notarization and code signing are handled during release packaging.</p>
      </div>
    </section>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "download", component: DownloadPage });
