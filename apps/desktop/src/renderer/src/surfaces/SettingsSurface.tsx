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
  THEME_MODES,
  getStoredThemePreference,
  setThemePreference,
  type ThemeMode,
} from "@tab/ui";
import type { PersonalMemory } from "@tab/contracts";
import type { DesktopStatus } from "../../../main/status";

type InitialState = Awaited<ReturnType<NonNullable<typeof window.tab>["getInitialState"]>>;
type SettingsTab = "account" | "controls" | "appearance" | "permissions" | "memory";

const SETTINGS_TABS: { value: SettingsTab; label: string; description: string }[] = [
  { value: "account", label: "Account", description: "Sign-in, quota, and connectivity" },
  { value: "controls", label: "Controls", description: "Pause or resume observation" },
  { value: "appearance", label: "Appearance", description: "Theme follows this Mac by default" },
  { value: "permissions", label: "Permissions", description: "macOS access required by Tab" },
  { value: "memory", label: "Memory", description: "Personalization snippets" },
];

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
    <div className="settings-row">
      <span className="settings-row__label">{label}</span>
      <div className="settings-row__value">{children}</div>
    </div>
  );
}

export function SettingsSurface() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    () => getStoredThemePreference(window.localStorage) ?? "system",
  );
  const [status, setStatus] = useState<DesktopStatus>(() => createFallbackStatus());
  const [memories, setMemories] = useState<PersonalMemory[]>([]);
  const [paused, setPaused] = useState(false);
  const [usePersonalMemory, setUsePersonalMemory] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState<"accessibility" | "input-monitoring" | null>(null);

  const refreshAccessibility = useCallback(async () => {
    if (!window.tab?.checkAccessibilityPermission) return false;
    const granted = Boolean(await window.tab.checkAccessibilityPermission());
    setAccessibilityGranted(granted);
    return granted;
  }, []);

  useEffect(() => {
    if (!window.tab) return;

    window.tab.onStatusChanged((nextStatus) => setStatus(nextStatus));
    window.tab.onMemoriesChanged((nextMemories) => setMemories(nextMemories));
    window.tab.onPauseChanged((nextPaused) => setPaused(nextPaused));
    window.tab.onPreferencesChanged((nextPreferences) => {
      setUsePersonalMemory(nextPreferences.suggestions.usePersonalMemory);
    });

    window.tab
      .getInitialState()
      .then((initialState: InitialState) => {
        setStatus(initialState.status);
        setMemories(initialState.memories);
        setPaused(initialState.paused);
        setUsePersonalMemory(initialState.preferences.suggestions.usePersonalMemory);
      })
      .catch(() => {});

    refreshAccessibility().catch(() => setAccessibilityGranted(false));
  }, [refreshAccessibility]);

  async function handleAccessibility() {
    setPermissionBusy("accessibility");
    try {
      const alreadyGranted = Boolean(await window.tab?.openAccessibilitySettings?.());
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
      await window.tab?.openInputMonitoringSettings?.();
      await window.tab?.revealAppInFinder?.();
    } finally {
      setPermissionBusy(null);
    }
  }

  function handleUsePersonalMemory(nextEnabled: boolean) {
    setUsePersonalMemory(nextEnabled);
    window.tab?.setUsePersonalMemoryForSuggestions?.(nextEnabled);
  }

  function handleThemeMode(nextMode: ThemeMode) {
    setThemeMode(nextMode);
    setThemePreference(nextMode);
  }

  return (
    <main className="desktop-shell">
      <SectionCard className="settings-tabs mx-auto grid h-full max-w-5xl overflow-hidden p-0">
        <aside className="settings-tabs__sidebar drag-region">
          <div className="settings-tabs__brand">
            <div className="settings-tabs__mark">T</div>
            <div>
              <p className="eyebrow">Tab</p>
              <h1>Settings</h1>
            </div>
          </div>

          <nav className="settings-tabs__nav no-drag" aria-label="Settings sections">
            {SETTINGS_TABS.map((tab) => (
              <button
                aria-current={activeTab === tab.value ? "page" : undefined}
                className="settings-tabs__item"
                data-active={activeTab === tab.value}
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                type="button"
              >
                <span className="settings-tabs__item-label">{tab.label}</span>
                <span className="settings-tabs__item-desc">{tab.description}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="no-drag flex min-h-0 flex-col overflow-hidden">
          <div className="settings-tabs__header drag-region">
            <p className="eyebrow">{SETTINGS_TABS.find((tab) => tab.value === activeTab)?.label}</p>
            <h2 className="settings-tabs__title">Control your native typing assistant.</h2>
          </div>

          <div className="settings-tabs__content">
          {paused ? (
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--tab-signal)_24%,transparent)] bg-[var(--tab-signal-tint)] px-4 py-3 text-sm font-medium text-[var(--tab-signal)]">
              Tab is paused. Typing observation and suggestions are disabled.
            </div>
          ) : null}

          {activeTab === "account" ? (
          <Card className="settings-pane shadow-none">
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
                  <Button variant="secondary" onClick={() => window.tab?.signOut?.()}>
                    Sign Out
                  </Button>
                ) : (
                  <Button onClick={() => window.tab?.signIn?.()}>Sign In</Button>
                )}
              </div>
            </CardContent>
          </Card>
          ) : null}

          {activeTab === "controls" ? (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Controls</CardTitle>
              <CardDescription>Pause local observation without signing out.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsRow label="Typing observation">
                <Button variant={paused ? "default" : "secondary"} onClick={() => window.tab?.togglePause?.()}>
                  {paused ? "Resume" : "Pause"}
                </Button>
              </SettingsRow>
            </CardContent>
          </Card>
          ) : null}

          {activeTab === "appearance" ? (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Use your macOS theme by default, or keep Tab pinned to light or dark.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsRow label="Theme">
                <div className="flex flex-wrap gap-2">
                  {THEME_MODES.map((mode) => (
                    <Button
                      key={mode}
                      onClick={() => handleThemeMode(mode)}
                      type="button"
                      variant={themeMode === mode ? "default" : "secondary"}
                    >
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </Button>
                  ))}
                </div>
              </SettingsRow>
            </CardContent>
          </Card>
          ) : null}

          {activeTab === "permissions" ? (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Permissions</CardTitle>
              <CardDescription>
                Accessibility supports Text Session understanding and accepted Suggestion insertion. Input Monitoring
                supports typing timing, acceptance shortcuts, and fallback Typing Context signals.
              </CardDescription>
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
                <Button variant="secondary" onClick={() => window.tab?.relaunchForPermissions?.()}>
                  Relaunch Tab
                </Button>
              </SettingsRow>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Tab does not request Screen Recording or Full Disk Access. Typing Context stays in memory only, Personal
                Memory stays visible and controlled by you, telemetry is metadata-only, and raw logs are not stored.
              </p>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                If macOS shows Electron in dev mode, it granted the Electron host instead of the packaged Tab app. Run
                <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                  bun run desktop:permissions
                </code>
                , enable Tab, then relaunch.
              </p>
            </CardContent>
          </Card>
          ) : null}

          {activeTab === "memory" ? (
          <Card className="settings-pane shadow-none">
            <CardHeader>
              <CardTitle>Personal Memory</CardTitle>
              <CardDescription>Control whether stored memories can personalize desktop suggestions.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <SettingsRow label="Use in suggestions">
                <Button
                  variant={usePersonalMemory ? "default" : "secondary"}
                  onClick={() => handleUsePersonalMemory(!usePersonalMemory)}
                >
                  {usePersonalMemory ? "Using Personal Memory" : "Do Not Use"}
                </Button>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Pasted text can still inform the current suggestion, but it is not saved to Personal Memory by default.
                </span>
              </SettingsRow>
              {memories.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/70 p-4 text-sm text-muted-foreground">
                  No Personal Memory stored yet.
                </div>
              ) : (
                memories.map((memory) => (
                  <div className="flex items-start justify-between gap-4 rounded-2xl border bg-background/40 p-4" key={memory.id}>
                    <div className="min-w-0">
                      <p className="text-sm leading-relaxed">{memory.content}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Created by {memory.createdBy}</p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => window.tab?.deleteMemory?.(memory.id)}>
                      Delete
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          ) : null}
          </div>
        </div>
      </SectionCard>
    </main>
  );
}
