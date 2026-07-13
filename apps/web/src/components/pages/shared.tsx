import type { ReactNode } from "react";
import {
  Alert,
  AlertDescription,
  Eyebrow,
  SurfaceHeader,
  buttonVariants,
} from "@tab/ui";

export type User = {
  id: string;
  name?: string;
  email?: string;
  emailVerified?: boolean;
};

export type AuthSearch = {
  device_id?: string;
  callback?: string;
  next?: string;
};

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatMonthlyPrice(monthlyPriceUsd: number): string {
  if (monthlyPriceUsd === 0) return "Free";
  return `${formatUsd(monthlyPriceUsd)}/mo`;
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCount(count: number): string {
  return new Intl.NumberFormat(undefined).format(count);
}

export function preserveAuthSearchParams(search: AuthSearch): string {
  const params = new URLSearchParams();
  if (search.device_id) params.set("device_id", search.device_id);
  if (search.callback) params.set("callback", search.callback);
  if (search.next) params.set("next", search.next);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function ErrorMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function HandoffFields({ search }: { search: AuthSearch }) {
  return (
    <>
      {search.device_id ? <input type="hidden" name="device_id" value={search.device_id} /> : null}
      {search.callback ? <input type="hidden" name="callback" value={search.callback} /> : null}
      {search.next ? <input type="hidden" name="next" value={search.next} /> : null}
    </>
  );
}

export function hasDesktopHandoff(search: AuthSearch): boolean {
  return Boolean(search.device_id || search.callback);
}

export function PageKicker({ children }: { children: ReactNode }) {
  return <Eyebrow>{children}</Eyebrow>;
}

export function AuthShell({
  eyebrow,
  title,
  description,
  handoff,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  handoff?: boolean;
  children: ReactNode;
}) {
  if (!handoff) {
    return (
      <section className="mx-auto grid max-w-md gap-8 py-10 sm:py-14">
        <SurfaceHeader eyebrow={eyebrow} title={title} description={description} headingLevel={1} />
        <div className="grid gap-5">{children}</div>
      </section>
    );
  }

  return (
    <section className="mx-auto grid max-w-4xl gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] lg:items-start lg:gap-14 lg:py-14">
      <div>
        <SurfaceHeader eyebrow={eyebrow} title={title} description={description} headingLevel={1} />
        <div className="mt-8 grid gap-4 rounded-[var(--radius-card)] bg-muted/35 p-5 text-sm">
          <div className="grid grid-cols-[1.25rem_1fr] gap-3">
            <span className="mt-1 size-1.5 rounded-full bg-emphasis" aria-hidden="true" />
            <p><span className="font-semibold text-foreground">Your password stays in the browser.</span> <span className="text-muted-foreground">The Mac app receives a revocable device token.</span></p>
          </div>
          <div className="grid grid-cols-[1.25rem_1fr] gap-3">
            <span className="mt-1 size-1.5 rounded-full bg-foreground/40" aria-hidden="true" />
            <p><span className="font-semibold text-foreground">Signing in does not save your recent typing.</span></p>
          </div>
        </div>
      </div>
      <div className="grid content-center gap-5">
        {children}
      </div>
    </section>
  );
}

export type MessagePageProps = {
  title: string;
  message: string;
  action?: { href: string; label: string };
};

export function MessagePage({ title, message, action }: MessagePageProps) {
  return (
    <section className="grid max-w-[34rem] gap-4 border-y border-border py-10">
      <h1 className="text-balance font-[var(--font-display)] text-3xl font-bold leading-tight tracking-[-0.015em]">{title}</h1>
      <p className="text-pretty leading-relaxed text-muted-foreground">{message}</p>
      {action ? <p><a className={buttonVariants()} href={action.href}>{action.label}</a></p> : null}
    </section>
  );
}
