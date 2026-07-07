import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SectionCard,
  StatusBadge,
} from "@tabb/ui";
import type { PersonalMemory } from "@tabb/contracts";
import type { DesktopStatus } from "../../../main/status";

type InitialState = Awaited<ReturnType<NonNullable<typeof window.tabb>["getInitialState"]>>;

function getAuthTone(auth: DesktopStatus["auth"]) {
  if (auth === "signed_in") return "ok";
  if (auth === "revoked_device") return "warning";
  return "muted";
}

function formatAuth(auth: DesktopStatus["auth"]) {
  return auth.replace(/_/g, " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function createFallbackStatus(): DesktopStatus {
  return {
    auth: "sign_in_required",
    connectivity: "online",
    userId: null,
    quota: null,
    overlay: "hidden",
    lastUpdatedAt: null,
  };
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-b-0">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export function SettingsSurface() {
  const [status, setStatus] = useState<DesktopStatus>(() => createFallbackStatus());
  const [memories, setMemories] = useState<PersonalMemory[]>([]);
  const [paused, setPaused] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState<"accessibility" | "input-monitoring" | null>(null);

  const refreshAccessibility = useCallback(async () => {
    if (!window.tabb?.checkAccessibilityPermission) return false;
    const granted = Boolean(await window.tabb.checkAccessibilityPermission());
    setAccessibilityGranted(granted);
    return granted;
  }, []);

  useEffect(() => {
    if (!window.tabb) return;

    window.tabb.onStatusChanged((nextStatus) => setStatus(nextStatus));
    window.tabb.onMemoriesChanged((nextMemories) => setMemories(nextMemories));
    window.tabb.onPauseChanged((nextPaused) => setPaused(nextPaused));

    window.tabb
      .getInitialState()
      .then((initialState: InitialState) => {
        setStatus(initialState.status);
        setMemories(initialState.memories);
        setPaused(initialState.paused);
      })
      .catch(() => {});

    refreshAccessibility().catch(() => setAccessibilityGranted(false));
  }, [refreshAccessibility]);

  async function handleAccessibility() {
    setPermissionBusy("accessibility");
    try {
      const alreadyGranted = Boolean(await window.tabb?.openAccessibilitySettings?.());
      setAccessibilityGranted(alreadyGranted);
      if (!alreadyGranted) {
        window.setTimeout(() => {
          refreshAccessibility().catch(() => {});
        }, 1200);
      }
    } finally {
      setPermissionBusy(null);
    }
  }

  async function handleInputMonitoring() {
    setPermissionBusy("input-monitoring");
    try {
      await window.tabb?.openInputMonitoringSettings?.();
      await window.tabb?.revealAppInFinder?.();
    } finally {
      setPermissionBusy(null);
    }
  }

  return (
    <main className="desktop-shell">
      <SectionCard className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden p-0">
        <div className="drag-region border-b border-border px-7 py-5">
          <p className="eyebrow">Tabb Settings</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.05em]">Control your native typing assistant.</h1>
        </div>

        <div className="no-drag flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-7">
          {paused ? (
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--tabb-signal)_24%,transparent)] bg-[var(--tabb-signal-tint)] px-4 py-3 text-sm font-medium text-[var(--tabb-signal)]">
              Tabb is paused. Typing observation and suggestions are disabled.
            </div>
          ) : null}

          <Card className="bg-muted/50 shadow-none">
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Sign-in, quota, and device connectivity for this Mac.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsRow label="Status">
                <StatusBadge tone={getAuthTone(status.auth)}>{formatAuth(status.auth)}</StatusBadge>
              </SettingsRow>
              <SettingsRow label="Plan">
                <span>{status.quota?.planId ?? "-"}</span>
              </SettingsRow>
              <SettingsRow label="Quota">
                <span>
                  {status.quota
                    ? `${status.quota.usage.toLocaleString()} / ${status.quota.quota.toLocaleString()} resets ${formatDate(status.quota.resetAt)}`
                    : "-"}
                </span>
              </SettingsRow>
              <SettingsRow label="Connectivity">
                <StatusBadge tone={status.connectivity === "online" ? "ok" : "warning"}>{status.connectivity}</StatusBadge>
              </SettingsRow>
              <div className="pt-4">
                {status.auth === "signed_in" ? (
                  <Button variant="secondary" onClick={() => window.tabb?.signOut?.()}>
                    Sign Out
                  </Button>
                ) : (
                  <Button onClick={() => window.tabb?.signIn?.()}>Sign In</Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-muted/50 shadow-none">
            <CardHeader>
              <CardTitle>Controls</CardTitle>
              <CardDescription>Pause local observation without signing out.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsRow label="Typing observation">
                <Button variant={paused ? "default" : "secondary"} onClick={() => window.tabb?.togglePause?.()}>
                  {paused ? "Resume" : "Pause"}
                </Button>
              </SettingsRow>
            </CardContent>
          </Card>

          <Card className="bg-muted/50 shadow-none">
            <CardHeader>
              <CardTitle>Permissions</CardTitle>
              <CardDescription>macOS permissions required for suggestions and acceptance.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsRow label="Accessibility">
                <StatusBadge tone={accessibilityGranted ? "ok" : "warning"}>
                  {accessibilityGranted ? "Enabled" : "Needs access"}
                </StatusBadge>
                <Button disabled={permissionBusy === "accessibility"} onClick={handleAccessibility}>
                  {accessibilityGranted ? "Reopen Settings" : "Open Settings"}
                </Button>
              </SettingsRow>
              <SettingsRow label="Input Monitoring">
                <StatusBadge tone="warning">Manual</StatusBadge>
                <Button disabled={permissionBusy === "input-monitoring"} onClick={handleInputMonitoring}>
                  Open Settings
                </Button>
                <Button variant="secondary" onClick={() => window.tabb?.relaunchForPermissions?.()}>
                  Relaunch Tabb
                </Button>
              </SettingsRow>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                If macOS shows Electron in dev mode, it granted the Electron host instead of the packaged Tabb app. Run
                <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                  bun run desktop:permissions
                </code>
                , enable Tabb, then relaunch.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-muted/50 shadow-none">
            <CardHeader>
              <CardTitle>Quick Memory</CardTitle>
              <CardDescription>Review memory snippets stored for autocomplete personalization.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {memories.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/70 p-4 text-sm text-muted-foreground">
                  No Personal Memory stored yet.
                </div>
              ) : (
                memories.map((memory) => (
                  <div className="flex items-start justify-between gap-4 rounded-2xl border bg-background/40 p-4" key={memory.id}>
                    <div className="min-w-0">
                      <p className="text-sm leading-relaxed">{memory.content}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{memory.category}</p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => window.tabb?.deleteMemory?.(memory.id)}>
                      Delete
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </SectionCard>
    </main>
  );
}
