import { createRoute } from "@tanstack/react-router";
import { Button, Card, CardContent } from "@tabb/ui";
import { rootRoute } from "./__root.tsx";

function LogoutPage() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <h1 className="text-4xl font-black tracking-[-0.06em]">Sign out</h1>
        <p className="text-muted-foreground">Use the button below to end your Tabb browser session.</p>
        <form method="post" action="/logout"><Button type="submit">Sign out</Button></form>
      </CardContent>
    </Card>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "logout", component: LogoutPage });
