import type { ReactNode } from "react";
import {
  Alert,
  AlertDescription,
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
  return `${new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(monthlyPriceUsd)}/mo`;
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
  return <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{children}</p>;
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
  return (
    <section className="mx-auto grid max-w-4xl border-y border-border lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <div className="py-8 lg:pr-14 lg:py-12">
        <SurfaceHeader eyebrow={eyebrow} title={title} description={description} headingLevel={1} />
        <div className="mt-8 grid border-t border-border text-sm">
          <div className="grid grid-cols-[1.25rem_1fr] gap-3 border-b border-border py-4">
            <span className="mt-1 size-1.5 rounded-full bg-[var(--success)]" aria-hidden="true" />
            <p><span className="font-semibold text-foreground">Secure connection.</span> <span className="text-muted-foreground">Your account connects this Mac without storing your password on it.</span></p>
          </div>
          <div className="grid grid-cols-[1.25rem_1fr] gap-3 border-b border-border py-4">
            <span className="mt-1 size-1.5 rounded-full bg-foreground/40" aria-hidden="true" />
            <p><span className="font-semibold text-foreground">Typing stays separate.</span> <span className="text-muted-foreground">Signing in does not save recent typing as a memory.</span></p>
          </div>
          {handoff ? <p className="py-4 font-medium text-foreground">After sign-in, this page returns you to Tab on your Mac.</p> : null}
        </div>
      </div>
      <div className="grid content-center gap-5 border-t border-border py-8 lg:border-l lg:border-t-0 lg:py-12 lg:pl-12">
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
      <h1 className="text-balance font-[var(--font-display)] text-3xl font-bold leading-tight">{title}</h1>
      <p className="text-pretty leading-relaxed text-muted-foreground">{message}</p>
      {action ? <p><a className={buttonVariants()} href={action.href}>{action.label}</a></p> : null}
    </section>
  );
}
