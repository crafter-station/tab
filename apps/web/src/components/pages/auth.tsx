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
    <AuthShell eyebrow={handoff ? "Mac sign-in" : "Account"} title={handoff ? "Connect this Mac" : "Sign in to Tab"} description={handoff ? "Sign in to connect Tab on this Mac. You will return to the app automatically." : "Manage your plan, connected Macs, and Personal Memory."} handoff={handoff}>
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
    <AuthShell eyebrow="Account recovery" title="Reset your password" description="Enter your account email and we will send a reset link.">
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
    <AuthShell eyebrow="Account recovery" title="Create a new password" description="Use at least 8 characters.">
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
          <p><Button className="w-full" type="submit">Save new password</Button></p>
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
  const handoff = hasDesktopHandoff(search);

  return (
    <AuthShell eyebrow={handoff ? "Mac sign-in" : "30-day Pro trial"} title="Create your Tab account" description="Try Pro for 30 days. No card required." handoff={handoff}>
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
            <Input id="signup-password" type="password" name="password" required autoComplete="new-password" minLength={8} />
          </Field>
        </FieldGroup>
        <p><Button className="w-full" type="submit">Create account</Button></p>
      </form>
      <p className="text-xs leading-relaxed text-muted-foreground">By creating an account, you agree to the <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/terms">Terms of Service</a> and <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="/privacy">Privacy Policy</a>.</p>
      <p className="text-sm text-muted-foreground">Already have an account? <a className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href={loginHref}>Sign in</a>.</p>
    </AuthShell>
  );
}
