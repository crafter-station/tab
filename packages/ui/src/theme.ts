export const THEME_MODES = ["system", "light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
export type AppliedThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "tab-theme";

type ThemeElement = {
  dataset: Record<string, string | undefined>;
  style?: {
    colorScheme?: string;
  };
  classList: {
    add(value: string): void;
    remove(value: string): void;
  };
};

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export type ApplyThemePreferenceOptions = {
  element: ThemeElement;
  mode?: ThemeMode;
  storage?: ThemeStorage | null;
  systemPrefersDark?: () => boolean;
};

export function isThemeMode(value: string | null): value is ThemeMode {
  return THEME_MODES.some((mode) => mode === value);
}

export function getStoredThemePreference(storage?: ThemeStorage | null): ThemeMode | undefined {
  if (!storage) return undefined;
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function systemPrefersDarkMode(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

export function resolveThemeMode(mode: ThemeMode | undefined, systemPrefersDark: () => boolean): AppliedThemeMode {
  if (mode === "light" || mode === "dark") return mode;
  return systemPrefersDark() ? "dark" : "light";
}

export function applyThemePreference(options: ApplyThemePreferenceOptions): AppliedThemeMode {
  const preferredMode = options.mode ?? getStoredThemePreference(options.storage) ?? "system";
  const appliedMode = resolveThemeMode(preferredMode, options.systemPrefersDark ?? systemPrefersDarkMode);

  options.element.dataset.theme = appliedMode;
  options.element.classList.remove("light");
  options.element.classList.remove("dark");
  options.element.classList.add(appliedMode);
  if (options.element.style) options.element.style.colorScheme = appliedMode;

  if (options.mode && options.storage) {
    try {
      options.storage.setItem(THEME_STORAGE_KEY, options.mode);
    } catch {
      // Local persistence should never block rendering.
    }
  }

  return appliedMode;
}

export function initializeThemePreference(): AppliedThemeMode | undefined {
  if (typeof document === "undefined") return undefined;
  return applyThemePreference({ element: document.documentElement, storage: window.localStorage });
}

export function setThemePreference(mode: ThemeMode): AppliedThemeMode | undefined {
  if (typeof document === "undefined") return undefined;
  return applyThemePreference({ element: document.documentElement, mode, storage: window.localStorage });
}

export function getThemeInitScript(): string {
  return `(() => { try { var mode = localStorage.getItem('${THEME_STORAGE_KEY}'); if (mode !== 'light' && mode !== 'dark' && mode !== 'system') mode = 'system'; var resolved = mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode; var root = document.documentElement; root.dataset.theme = resolved; root.classList.remove('light', 'dark'); root.classList.add(resolved); root.style.colorScheme = resolved; } catch (_) {} })();`;
}

export function getThemeControlScript(): string {
  return `(() => { function resolve(mode) { return mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode; } function apply(mode) { var resolved = resolve(mode); var root = document.documentElement; root.dataset.theme = resolved; root.classList.remove('light', 'dark'); root.classList.add(resolved); root.style.colorScheme = resolved; } function applyPressed(mode) { document.querySelectorAll('[data-theme-choice]').forEach(function(button) { button.setAttribute('aria-pressed', button.getAttribute('data-theme-choice') === mode ? 'true' : 'false'); }); } function currentMode() { try { var mode = localStorage.getItem('${THEME_STORAGE_KEY}'); return mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system'; } catch (_) { return 'system'; } } applyPressed(currentMode()); document.addEventListener('click', function(event) { var target = event.target instanceof Element ? event.target.closest('[data-theme-choice]') : null; if (!target) return; var mode = target.getAttribute('data-theme-choice') || 'system'; if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return; try { localStorage.setItem('${THEME_STORAGE_KEY}', mode); apply(mode); applyPressed(mode); } catch (_) {} }); try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() { if (currentMode() === 'system') apply('system'); }); } catch (_) {} })();`;
}
