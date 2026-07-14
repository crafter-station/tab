import { describe, expect, it } from "bun:test";
import { createMacOSInputTap } from "../apps/desktop/src/main/macos-input-tap.ts";

function createProcessHarness() {
  let stdout: ((chunk: Buffer) => void) | undefined;
  let stderr: ((chunk: Buffer) => void) | undefined;
  let exit: ((code: number | null, signal: string | null) => void) | undefined;
  let killCount = 0;

  return {
    process: {
      stdout: {
        on: (_event: "data", callback: (chunk: Buffer) => void) => {
          stdout = callback;
        },
      },
      stderr: {
        on: (_event: "data", callback: (chunk: Buffer) => void) => {
          stderr = callback;
        },
      },
      on: (
        _event: "exit",
        callback: (code: number | null, signal: string | null) => void,
      ) => {
        exit = callback;
      },
      kill: () => {
        killCount += 1;
        return true;
      },
    },
    writeStdout: (value: string) => stdout?.(Buffer.from(value)),
    writeStderr: (value: string) => stderr?.(Buffer.from(value)),
    exit: (code: number | null, signal: string | null) => exit?.(code, signal),
    getKillCount: () => killCount,
  };
}

describe("macOS input tap", () => {
  it("frames chunked helper output and forwards complete JSON messages", () => {
    const harness = createProcessHarness();
    const messages: unknown[] = [];
    const errors: unknown[][] = [];
    const inputTap = createMacOSInputTap({
      executablePath: "/app/macos-input-tap",
      platform: "darwin",
      executableExists: () => true,
      spawnHelper: () => harness.process,
      onMessage: (message) => messages.push(message),
      onError: (...details) => errors.push(details),
    });

    inputTap.start();
    harness.writeStdout('{"type":"ready"}\n{"type":"te');
    harness.writeStdout('xt","text":"hello"}\n\n');

    expect(messages).toEqual([
      { type: "ready" },
      { type: "text", text: "hello" },
    ]);
    expect(errors).toEqual([]);
  });

  it("reports malformed output, stderr, and process exit without stopping valid messages", () => {
    const harness = createProcessHarness();
    const messages: unknown[] = [];
    const errors: unknown[][] = [];
    const inputTap = createMacOSInputTap({
      executablePath: "/app/macos-input-tap",
      platform: "darwin",
      executableExists: () => true,
      spawnHelper: () => harness.process,
      onMessage: (message) => messages.push(message),
      onError: (...details) => errors.push(details),
    });

    inputTap.start();
    harness.writeStdout('not-json\n{"type":"ready"}\n');
    harness.writeStderr("permission denied");
    harness.exit(1, null);

    expect(messages).toEqual([{ type: "ready" }]);
    expect(errors[0]?.[0]).toBe("Failed to parse macOS input tap message:");
    expect(errors[1]).toEqual(["macOS input tap stderr:", "permission denied"]);
    expect(errors[2]).toEqual([
      "macOS input tap exited with code 1 signal null",
    ]);
  });

  it("gates startup by platform and executable availability", () => {
    let spawnCount = 0;
    const errors: unknown[][] = [];
    const create = (platform: NodeJS.Platform, executableExists: boolean) =>
      createMacOSInputTap({
        executablePath: "/missing/macos-input-tap",
        platform,
        executableExists: () => executableExists,
        spawnHelper: () => {
          spawnCount += 1;
          return createProcessHarness().process;
        },
        onMessage: () => {},
        onError: (...details) => errors.push(details),
      });

    create("linux", true).start();
    create("darwin", false).start();

    expect(spawnCount).toBe(0);
    expect(errors).toEqual([
      ["macOS input tap helper missing at /missing/macos-input-tap"],
    ]);
  });

  it("owns helper startup and shutdown lifecycle", () => {
    const first = createProcessHarness();
    const second = createProcessHarness();
    let spawnCount = 0;
    const inputTap = createMacOSInputTap({
      executablePath: "/app/macos-input-tap",
      platform: "darwin",
      executableExists: () => true,
      spawnHelper: () => (spawnCount++ === 0 ? first.process : second.process),
      onMessage: () => {},
      onError: () => {},
    });

    inputTap.start();
    inputTap.start();
    expect(spawnCount).toBe(1);

    inputTap.stop();
    inputTap.stop();
    expect(first.getKillCount()).toBe(1);

    inputTap.start();
    expect(spawnCount).toBe(2);
  });
});
