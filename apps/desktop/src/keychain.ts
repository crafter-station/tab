import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Keychain {
  set(service: string, account: string, value: string): Promise<void>;
  get(service: string, account: string): Promise<string | null>;
  remove(service: string, account: string): Promise<void>;
}

export function createMacOSKeychain(): Keychain {
  return {
    async set(service, account, value) {
      // -U updates an existing item so the call is idempotent.
      await execFileAsync("security", [
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
        const { stdout } = await execFileAsync("security", [
          "find-generic-password",
          "-s",
          service,
          "-a",
          account,
          "-w",
        ]);
        return stdout.trim() || null;
      } catch {
        return null;
      }
    },
    async remove(service, account) {
      try {
        await execFileAsync("security", [
          "delete-generic-password",
          "-s",
          service,
          "-a",
          account,
        ]);
      } catch {
        // Ignore failures when the item does not exist.
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
