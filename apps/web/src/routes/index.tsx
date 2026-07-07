import { createRoute } from "@tanstack/react-router";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tabb/ui";
import { rootRoute } from "./__root.tsx";

function HomePage() {
  return (
    <>
      <section className="grid gap-8 overflow-hidden rounded-[2rem] border bg-[radial-gradient(circle_at_85%_20%,#ffcf70_0,transparent_28%),linear-gradient(135deg,#fff6df,#efe0c4)] p-[clamp(1.25rem,4vw,3.5rem)] md:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
        <div>
          <p className="text-muted-foreground">Native autocomplete for macOS</p>
          <h1 className="mb-4 text-[clamp(2.5rem,8vw,5.75rem)] leading-[0.9] font-black tracking-[-0.08em]">Write faster without changing where you write.</h1>
          <p className="max-w-2xl text-[clamp(1.05rem,2vw,1.35rem)] text-muted-foreground">
            Tabb suggests the next few words while you type in Mail, Slack, Notes, Ghostty, and everywhere else you write.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <a href="/download">Download for macOS</a>
            </Button>
            <Button asChild variant="secondary">
              <a href="/pricing">See pricing</a>
            </Button>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Built for trust</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-muted-foreground">
            <p>Your typing context stays on your Mac. Personal Memory is stored in your account and visible only to you.</p>
            <p>Accept suggestions with Option+Tab or a click when the lightweight overlay appears.</p>
          </CardContent>
        </Card>
      </section>
      <section className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <Card><CardHeader><CardTitle>Works everywhere</CardTitle><CardDescription>Use one native assistant across the apps where you already write.</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Personal Memory</CardTitle><CardDescription>Review and delete stored memories from your account dashboard.</CardDescription></CardHeader></Card>
        <Card><CardHeader><CardTitle>Usage controls</CardTitle><CardDescription>Track quota, billing, linked devices, and account status in one place.</CardDescription></CardHeader></Card>
      </section>
    </>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
