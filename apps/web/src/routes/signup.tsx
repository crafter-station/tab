import { createRoute } from "@tanstack/react-router";
import { Button, Card, CardContent, Input, Label } from "@tabb/ui";
import { rootRoute } from "./__root.tsx";

function SignupPage() {
  return (
    <Card className="max-w-[34rem]">
      <CardContent className="pt-6">
      <h1 className="mb-6 text-4xl font-black tracking-[-0.06em]">Create your account</h1>
      <form className="flex flex-col gap-4" method="post" action="/signup">
        <Label>Name<Input type="text" name="name" required autoComplete="name" /></Label>
        <Label>Email<Input type="email" name="email" required autoComplete="email" /></Label>
        <Label>Password<Input type="password" name="password" required autoComplete="new-password" /></Label>
        <p><Button type="submit">Sign up</Button></p>
      </form>
      <p className="mt-4 text-muted-foreground">Already have an account? <a className="underline" href="/login">Sign in</a>.</p>
      </CardContent>
    </Card>
  );
}

export const Route = createRoute({ getParentRoute: () => rootRoute, path: "signup", component: SignupPage });
