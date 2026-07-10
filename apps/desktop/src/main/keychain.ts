import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MacOSSecurityCommand = (
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

const runMacOSSecurityCommand: MacOSSecurityCommand = async (args) => {
  const { stdout, stderr } = await execFileAsync("security", [...args]);
  return { stdout, stderr };
};

function errorNumber(error: unknown, property: "code" | "status"): number | null {
  if (typeof error !== "object" || error === null || !(property in error)) return null;
  const value = (error as Record<string, unknown>)[property];
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

function errorStderr(error: unknown): string {
  if (typeof error !== "object" || error === null || !("stderr" in error)) return "";
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string") return stderr;
  if (stderr instanceof Uint8Array) return Buffer.from(stderr).toString("utf8");
  return "";
}

export function isMacOSKeychainItemNotFound(error: unknown): boolean {
  const code = errorNumber(error, "code") ?? errorNumber(error, "status");
  if (code === -25300) return true;
  if (code !== 44) return false;

  return /errSecItemNotFound|-25300|The specified item could not be found in the keychain/i.test(
    errorStderr(error),
  );
}

export interface Keychain {
  set(service: string, account: string, value: string): Promise<void>;
  get(service: string, account: string): Promise<string | null>;
  remove(service: string, account: string): Promise<void>;
}

export function createMacOSKeychain(
  runSecurity: MacOSSecurityCommand = runMacOSSecurityCommand,
): Keychain {
  return {
    async set(service, account, value) {
      // -U updates an existing item so the call is idempotent.
      await runSecurity([
        "add-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-w",
        value,
        "-U",
      ]);
    },
    async get(service, account) {
      try {
        const { stdout } = await runSecurity([
          "find-generic-password",
          "-s",
          service,
          "-a",
          account,
          "-w",
        ]);
        return stdout.trim();
      } catch (error) {
        if (isMacOSKeychainItemNotFound(error)) return null;
        throw error;
      }
    },
    async remove(service, account) {
      try {
        await runSecurity([
          "delete-generic-password",
          "-s",
          service,
          "-a",
          account,
        ]);
      } catch (error) {
        if (!isMacOSKeychainItemNotFound(error)) throw error;
      }
    },
  };
}

export function createMemoryKeychain(): Keychain {
  const store = new Map<string, string>();

  function key(service: string, account: string) {
    return `${service}:${account}`;
  }

  return {
    async set(service, account, value) {
      store.set(key(service, account), value);
    },
    async get(service, account) {
      return store.get(key(service, account)) ?? null;
    },
    async remove(service, account) {
      store.delete(key(service, account));
    },
  };
}
