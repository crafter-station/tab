import { createRoute } from "@tanstack/react-router";
import { Button, Card, CardContent } from "@tab/ui";
import { rootRoute } from "./__root.tsx";

function LogoutPage() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <h1 className="text-balance font-[var(--font-display)] text-3xl font-bold leading-tight">Sign out</h1>
        <p className="text-pretty text-base text-muted-foreground">Sign out of Tab in this browser.</p>
        <form method="post" action="/logout"><Button type="submit">Sign out</Button></form>
      </CardContent>
    </Card>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "logout", component: LogoutPage });
