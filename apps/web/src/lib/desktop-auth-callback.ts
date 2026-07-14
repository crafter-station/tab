export function parseDesktopAuthCallback(value: string): URL | null {
  try {
    const callback = new URL(value);
    if (callback.protocol === "tab:") return callback;

    const isDevelopmentLoopback = callback.protocol === "http:"
      && callback.hostname === "127.0.0.1"
      && callback.port !== ""
      && callback.pathname === "/auth/callback"
      && callback.username === ""
      && callback.password === "";
    return isDevelopmentLoopback ? callback : null;
  } catch {
    return null;
  }
}
