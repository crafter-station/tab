import type { Context, Next } from "hono";
import type { AuthInstance } from "../auth.ts";
import type { DeviceTokenService } from "../device-tokens.ts";
import type { ApiVariables } from "../api-types.ts";
import { createErrorResponse } from "./responses.ts";

export function createDeviceAuthenticator(deviceTokenService: DeviceTokenService) {
  return async function authenticateDevice(
    c: Context<{ Variables: ApiVariables }>,
    next: Next,
  ) {
    const authorization = c.req.header("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return c.json(
        createErrorResponse("unauthenticated", "Device token required."),
        401,
      );
    }

    const token = authorization.slice("Bearer ".length);
    const device = await deviceTokenService.verifyDeviceToken(token);

    if (!device) {
      return c.json(
        createErrorResponse("unauthenticated", "Invalid device token."),
        401,
      );
    }

    if (device.revoked) {
      return c.json(
        createErrorResponse("revoked_device", "This device has been revoked."),
        401,
      );
    }

    c.set("device", device);
    await next();
  };
}

export function createSessionAuthenticator(auth: AuthInstance) {
  return async function authenticateSession(
    c: Context<{ Variables: ApiVariables }>,
    next: Next,
  ) {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json(
        createErrorResponse("unauthenticated", "Sign in required."),
        401,
      );
    }

    c.set("session", session);
    await next();
  }
}
