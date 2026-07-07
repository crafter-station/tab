import { createRoute, useSearch } from "@tanstack/react-router";
import { Button, Card, CardContent, Input, Label } from "@tabb/ui";
import { rootRoute } from "./__root.tsx";

function LoginPage() {
  const search = useSearch({ strict: false }) as { device_id?: string; callback?: string };

  return (
    <Card className="max-w-[34rem]">
      <CardContent className="pt-6">
      <h1 className="mb-6 text-4xl font-black tracking-[-0.06em]">Sign in</h1>
      <form className="flex flex-col gap-4" method="post" action="/login">
        {search.device_id ? <input type="hidden" name="device_id" value={search.device_id} /> : null}
        {search.callback ? <input type="hidden" name="callback" value={search.callback} /> : null}
        <Label>Email<Input type="email" name="email" required autoComplete="email" /></Label>
        <Label>Password<Input type="password" name="password" required autoComplete="current-password" /></Label>
        <p><Button type="submit">Sign in</Button></p>
      </form>
      <p className="mt-4 text-muted-foreground">Need an account? <a className="underline" href="/signup">Create one</a>.</p>
      </CardContent>
    </Card>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "login", component: LoginPage });
