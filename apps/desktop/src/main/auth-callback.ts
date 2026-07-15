import { createServer, type Server, type ServerResponse } from "node:http";
import { PLATFORM_COLORS } from "@tab/ui/platform-colors";

export type LoopbackAuthCallbackServer = {
  readonly callbackUrl: string;
  close(): Promise<void>;
};

export type LoopbackAuthCallback = {
  getCallbackUrl(): Promise<string>;
  close(): Promise<void>;
};

export type PackagedAuthCallback = {
  dispatch(url: string): boolean;
  activate(startupArgs: readonly string[]): void;
};

type LoopbackAuthCallbackServerDependencies = {
  onCallback(url: string): Promise<void>;
};

export function createLoopbackAuthCallback(
  deps: LoopbackAuthCallbackServerDependencies,
): LoopbackAuthCallback {
  let server: Promise<LoopbackAuthCallbackServer> | null = null;

  return {
    async getCallbackUrl() {
      server ??= startLoopbackAuthCallbackServer(deps).catch((error) => {
        server = null;
        throw error;
      });
      return (await server).callbackUrl;
    },
    async close() {
      const activeServer = server;
      server = null;
      if (activeServer) await (await activeServer).close();
    },
  };
}

function sendHtml(serverResponse: ServerResponse, status: number, title: string, message: string): void {
  const light = PLATFORM_COLORS.theme.light;
  const dark = PLATFORM_COLORS.theme.dark;
  serverResponse.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": "text/html; charset=utf-8",
  });
  serverResponse.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light dark"><title>${title}</title><style>body{font:16px system-ui;margin:4rem auto;max-width:32rem;padding:0 1rem;color:${light.foreground};background:${light.background}}h1{font-size:1.5rem}@media(prefers-color-scheme:dark){body{color:${dark.foreground};background:${dark.background}}}</style></head><body><h1>${title}</h1><p>${message}</p></body></html>`);
}

export function isAuthCallbackUrl(candidate: string, expectedCallbackUrl: string): boolean {
  try {
    const actual = new URL(candidate);
    const expected = new URL(expectedCallbackUrl);
    return actual.protocol === expected.protocol
      && actual.username === expected.username
      && actual.password === expected.password
      && actual.host === expected.host
      && actual.pathname === expected.pathname
      && Boolean(actual.searchParams.get("code"));
  } catch {
    return false;
  }
}

export function findAuthCallbackUrl(args: readonly string[], expectedCallbackUrl: string): string | null {
  return args.find((arg) => isAuthCallbackUrl(arg, expectedCallbackUrl)) ?? null;
}

export function createPackagedAuthCallback(deps: {
  readonly expectedCallbackUrl: string;
  readonly onCallback: (url: string) => Promise<void>;
  readonly onError?: (error: unknown) => void;
}): PackagedAuthCallback {
  let active = false;
  const pendingUrls: string[] = [];
  const receivedUrls = new Set<string>();

  function deliver(url: string): void {
    deps.onCallback(url).catch((error) => deps.onError?.(error));
  }

  function dispatch(url: string): boolean {
    if (!isAuthCallbackUrl(url, deps.expectedCallbackUrl)) return false;
    if (receivedUrls.has(url)) return true;

    receivedUrls.add(url);
    if (active) deliver(url);
    else pendingUrls.push(url);
    return true;
  }

  return {
    dispatch,
    activate(startupArgs) {
      active = true;
      const startupUrl = findAuthCallbackUrl(
        startupArgs,
        deps.expectedCallbackUrl,
      );
      if (startupUrl) dispatch(startupUrl);
      for (const url of pendingUrls.splice(0)) deliver(url);
    },
  };
}

export async function startLoopbackAuthCallbackServer(
  deps: LoopbackAuthCallbackServerDependencies,
): Promise<LoopbackAuthCallbackServer> {
  let callbackUrl: string | null = null;
  const server: Server = createServer((request, response) => {
    void (async () => {
      if (!callbackUrl) {
        sendHtml(response, 503, "Tab sign-in unavailable", "Return to Tab and try again.");
        return;
      }

      const requestUrl = new URL(request.url ?? "/", callbackUrl);
      if (request.method !== "GET" || requestUrl.origin !== new URL(callbackUrl).origin || requestUrl.pathname !== "/auth/callback") {
        sendHtml(response, 404, "Not found", "This address is only used to complete Tab sign-in.");
        return;
      }
      if (!requestUrl.searchParams.get("code")) {
        sendHtml(response, 400, "Tab sign-in failed", "The authorization code is missing. Return to Tab and try again.");
        return;
      }

      try {
        await deps.onCallback(requestUrl.toString());
        sendHtml(response, 200, "Signed in to Tab", "You can close this tab and return to Tab.");
      } catch (error) {
        console.error("Failed to complete loopback browser handoff:", error);
        sendHtml(response, 500, "Tab sign-in failed", "Return to Tab and try again.");
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to resolve the local auth callback address.");
  }
  callbackUrl = `http://127.0.0.1:${address.port}/auth/callback`;

  return {
    callbackUrl,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      server.closeAllConnections();
    }),
  };
}
