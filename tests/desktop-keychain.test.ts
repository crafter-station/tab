import { describe, expect, it } from "bun:test";
import {
  createMacOSKeychain,
  isMacOSKeychainItemNotFound,
} from "../apps/desktop/src/main/keychain.ts";

describe("macOS keychain", () => {
  it("preserves an empty value from a successful credential read", async () => {
    const keychain = createMacOSKeychain(async () => ({ stdout: "\n", stderr: "" }));

    expect(await keychain.get("tab", "device-token")).toBe("");
  });

  it("returns null for a genuine item-not-found error when reading a credential", async () => {
    const notFound = Object.assign(new Error("security command failed"), {
      code: 44,
      stderr:
        "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n",
    });
    const keychain = createMacOSKeychain(async () => {
      throw notFound;
    });

    expect(await keychain.get("tab", "device-token")).toBeNull();
  });

  it("propagates operational read failures", async () => {
    const operationalFailure = Object.assign(new Error("security command failed"), {
      code: 36,
      stderr: "security: SecKeychainSearchCopyNext: User interaction is not allowed.\n",
    });
    const keychain = createMacOSKeychain(async () => {
      throw operationalFailure;
    });
    let caught: unknown;

    try {
      await keychain.get("tab", "device-token");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(operationalFailure);
  });

  it("ignores a genuine item-not-found error when removing a credential", async () => {
    const notFound = Object.assign(new Error("security command failed"), {
      code: 44,
      stderr:
        "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n",
    });
    const keychain = createMacOSKeychain(async () => {
      throw notFound;
    });

    await keychain.remove("tab", "device-token");
    expect(isMacOSKeychainItemNotFound(notFound)).toBe(true);
  });

  it("propagates operational removal failures", async () => {
    const operationalFailure = Object.assign(new Error("security command failed"), {
      code: 44,
      stderr: "security: SecKeychainDelete: User interaction is not allowed.\n",
    });
    const keychain = createMacOSKeychain(async () => {
      throw operationalFailure;
    });
    let caught: unknown;

    try {
      await keychain.remove("tab", "device-token");
    } catch (error) {
      caught = error;
    }

    expect(isMacOSKeychainItemNotFound(operationalFailure)).toBe(false);
    expect(caught).toBe(operationalFailure);
  });
});
