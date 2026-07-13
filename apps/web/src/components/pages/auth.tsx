import {
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
} from "@tab/ui";
import {
  AuthShell,
  ErrorMessage,
  HandoffFields,
  type AuthSearch,
  hasDesktopHandoff,
  preserveAuthSearchParams,
} from "./shared.tsx";

export function LoginPage({ search = {}, error }: { search?: AuthSearch; error?: string }) {
  const signupHref = `/signup${preserveAuthSearchParams(search)}`;
  const handoff = hasDesktopHandoff(search);

  return (
    <AuthShell eyebrow={handoff ? "Mac sign-in" : "Account access"} title="Sign in" description="Open your Tab account or finish connecting this Mac." handoff={handoff}>
      <form className="flex flex-col gap-4" method="post" action="/login">
        <ErrorMessage message={error} />
        <HandoffFields search={search} />
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="login-email">Email</FieldLabel>
            <Input id="login-email" type="email" name="email" required autoComplete="email" />
          </Field>
          <Field>
            <FieldLabel htmlFor="login-password">Password</FieldLabel>
            <Input id="login-password" type="password" name="password" required autoComplete="current-password" />
          </Field>
        </FieldGroup>
        <p><Button className="w-full" type="submit">Sign in</Button></p>
      </form>
      <p className="text-sm text-muted-foreground"><a className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href="/forgot-password">Forgot your password?</a></p>
      <p className="text-sm text-muted-foreground">Need an account? <a className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href={signupHref}>Create one</a>.</p>
    </AuthShell>
  );
}

export function ForgotPasswordPage({ error, sent }: { error?: string; sent?: boolean }) {
  return (
    <AuthShell eyebrow="Account recovery" title="Reset password" description="Request a secure reset link for your Tab account.">
      {sent ? (
        <p className="text-muted-foreground">If an account exists for that email, a password reset link is on the way.</p>
      ) : (
        <form className="flex flex-col gap-4" method="post" action="/forgot-password">
          <ErrorMessage message={error} />
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="forgot-password-email">Email</FieldLabel>
              <Input id="forgot-password-email" type="email" name="email" required autoComplete="email" />
            </Field>
          </FieldGroup>
          <p><Button className="w-full" type="submit">Send reset link</Button></p>
        </form>
      )}
      <p className="text-sm text-muted-foreground"><a className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href="/login">Back to sign in</a>.</p>
    </AuthShell>
  );
}

export function ResetPasswordPage({ error, token }: { error?: string; token?: string }) {
  return (
    <AuthShell eyebrow="Account recovery" title="Choose a new password" description="Set a new password for your Tab account.">
      {token ? (
        <form className="flex flex-col gap-4" method="post" action="/reset-password">
          <ErrorMessage message={error} />
          <input type="hidden" name="token" value={token} />
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="reset-password">New password</FieldLabel>
              <Input id="reset-password" type="password" name="password" required autoComplete="new-password" minLength={8} />
            </Field>
          </FieldGroup>
          <p><Button className="w-full" type="submit">Update password</Button></p>
        </form>
      ) : (
        <p className="text-muted-foreground">This reset link is invalid or expired. Request a new password reset link.</p>
      )}
      <p className="text-sm text-muted-foreground"><a className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href="/forgot-password">Request another link</a>.</p>
    </AuthShell>
  );
}

export function SignupPage({ search = {}, error }: { search?: AuthSearch; error?: string }) {
  const loginHref = `/login${preserveAuthSearchParams(search)}`;

  return (
    <AuthShell eyebrow="Account access" title="Create your account" description="Start a 30-day Pro trial with one identity for connected Macs, Deep Complete, and saved memories. No card required." handoff={hasDesktopHandoff(search)}>
      <form className="flex flex-col gap-4" method="post" action="/signup">
        <ErrorMessage message={error} />
        <HandoffFields search={search} />
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="signup-name">Name</FieldLabel>
            <Input id="signup-name" type="text" name="name" required autoComplete="name" />
          </Field>
          <Field>
            <FieldLabel htmlFor="signup-email">Email</FieldLabel>
            <Input id="signup-email" type="email" name="email" required autoComplete="email" />
          </Field>
          <Field>
            <FieldLabel htmlFor="signup-password">Password</FieldLabel>
            <Input id="signup-password" type="password" name="password" required autoComplete="new-password" />
          </Field>
        </FieldGroup>
        <p><Button className="w-full" type="submit">Create account</Button></p>
      </form>
      <p className="text-sm text-muted-foreground">Already have an account? <a className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href={loginHref}>Sign in</a>.</p>
    </AuthShell>
  );
}
