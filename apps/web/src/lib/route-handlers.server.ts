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

export const routeHandlers = {
  login: (request: Request) => handleLogin(request, api()),
  signup: (request: Request) => handleSignup(request, api()),
  forgotPassword: (request: Request) => handleForgotPassword(request, api()),
  resetPassword: (request: Request) => handleResetPassword(request, api()),
  logout: (request: Request) => handleLogout(request, api()),
  checkout: (request: Request) => handleCheckout(request, api()),
  portal: (request: Request) => handlePortal(request, api()),
  deviceRevoke: (request: Request, deviceId: string) => handleDeviceRevoke(request, api(), deviceId),
  memoryCreate: (request: Request) => handleMemoryCreate(request, api()),
  memoryEdit: (request: Request, memoryId: string) => handleMemoryEdit(request, api(), memoryId),
  memoryDelete: (request: Request, memoryId: string) => handleMemoryDelete(request, api(), memoryId),
  memoryBulkDelete: (request: Request) => handleMemoryBulkDelete(request, api()),
  memoryExport: (request: Request) => handleMemoryExport(request, api()),
};
