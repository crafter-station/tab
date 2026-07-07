import { createRoute } from "@tanstack/react-router";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@tabb/ui";
import { rootRoute } from "./__root.tsx";

function DownloadPage() {
  return (
    <section className="grid gap-8 overflow-hidden rounded-[2rem] border bg-[radial-gradient(circle_at_85%_20%,#ffcf70_0,transparent_28%),linear-gradient(135deg,#fff6df,#efe0c4)] p-[clamp(1.25rem,4vw,3.5rem)] md:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
      <div>
        <h1 className="mb-4 text-[clamp(2.5rem,8vw,5.75rem)] leading-[0.9] font-black tracking-[-0.08em]">Download Tabb for macOS</h1>
        <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] text-muted-foreground">Install the native autocomplete app directly on your Mac.</p>
        <p className="mt-6"><Button asChild><a href="/download/tabb.dmg">Download Tabb.dmg</a></Button></p>
      </div>
      <Card>
        <CardHeader><CardTitle>Before you start</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-muted-foreground">
          <p>Tabb requires macOS Accessibility permission to show and accept inline suggestions.</p>
          <p>macOS 14+. Notarization and code signing are handled during release packaging.</p>
        </CardContent>
      </Card>
    </section>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "download", component: DownloadPage });
