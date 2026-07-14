export type DeviceApiClient = {
  request(path: string, init?: RequestInit): Promise<Response>;
  requestAuthorized(path: string, init?: RequestInit): Promise<Response | null>;
};

export function createDeviceApiClient(deps: {
  readonly apiBaseUrl: string;
  readonly getAuthorizationHeader: () => Promise<string | null>;
  readonly fetch?: typeof globalThis.fetch;
}): DeviceApiClient {
  const http = deps.fetch ?? globalThis.fetch;

  function send(
    path: string,
    init: RequestInit,
    authorization: string | null,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    headers.delete("Authorization");
    if (authorization) headers.set("Authorization", authorization);

    return http(new URL(path, deps.apiBaseUrl), { ...init, headers });
  }

  return {
    async request(path, init) {
      return send(path, init ?? {}, await deps.getAuthorizationHeader());
    },
    async requestAuthorized(path, init) {
      const authorization = await deps.getAuthorizationHeader();
      return authorization ? send(path, init ?? {}, authorization) : null;
    },
  };
}
