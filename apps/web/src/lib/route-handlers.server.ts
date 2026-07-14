import { createRuntimeApiClient } from "./api.server.ts";
import {
  handleCheckout,
  handleDeviceRevoke,
  handleForgotPassword,
  handleLogin,
  handleLogout,
  handleMemoryBulkDelete,
  handleMemoryCreate,
  handleMemoryDelete,
  handleMemoryEdit,
  handleMemoryExport,
  handlePortal,
  handleResetPassword,
  handleSignup,
} from "./actions.server.ts";
import { getRuntimeConfig } from "./runtime.server.ts";

function api() {
  return createRuntimeApiClient(getRuntimeConfig());
}

function unsafeHandler<T extends unknown[]>(handler: (request: Request, ...args: T) => Promise<Response>) {
  return (request: Request, ...args: T): Promise<Response> => {
    const origin = request.headers.get("origin");
    const isCrossSite = request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site";
    if (isCrossSite || (origin !== null && origin !== new URL(request.url).origin)) {
      return Promise.resolve(new Response("Forbidden", { status: 403 }));
    }
    return handler(request, ...args);
  };
}

export const routeHandlers = {
  login: unsafeHandler((request: Request) => handleLogin(request, api())),
  signup: unsafeHandler((request: Request) => handleSignup(request, api())),
  forgotPassword: unsafeHandler((request: Request) => handleForgotPassword(request, api())),
  resetPassword: unsafeHandler((request: Request) => handleResetPassword(request, api())),
  logout: unsafeHandler((request: Request) => handleLogout(request, api())),
  checkout: (request: Request) => handleCheckout(request, api()),
  portal: (request: Request) => handlePortal(request, api()),
  deviceRevoke: unsafeHandler((request: Request, deviceId: string) => handleDeviceRevoke(request, api(), deviceId)),
  memoryCreate: unsafeHandler((request: Request) => handleMemoryCreate(request, api())),
  memoryEdit: unsafeHandler((request: Request, memoryId: string) => handleMemoryEdit(request, api(), memoryId)),
  memoryDelete: unsafeHandler((request: Request, memoryId: string) => handleMemoryDelete(request, api(), memoryId)),
  memoryBulkDelete: unsafeHandler((request: Request) => handleMemoryBulkDelete(request, api())),
  memoryExport: (request: Request) => handleMemoryExport(request, api()),
};
