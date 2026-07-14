import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

type InputTapProcess = {
  readonly stdout: {
    on(event: "data", callback: (chunk: Buffer) => void): void;
  };
  readonly stderr: {
    on(event: "data", callback: (chunk: Buffer) => void): void;
  };
  on(
    event: "exit",
    callback: (code: number | null, signal: string | null) => void,
  ): void;
  kill(): boolean;
};

export type MacOSInputTapDependencies = {
  readonly executablePath: string;
  readonly onMessage: (message: unknown) => void;
  readonly onError: (...details: unknown[]) => void;
  readonly platform?: NodeJS.Platform;
  readonly executableExists?: (path: string) => boolean;
  readonly spawnHelper?: (path: string) => InputTapProcess;
};

export function createMacOSInputTap(deps: MacOSInputTapDependencies) {
  const platform = deps.platform ?? process.platform;
  const executableExists = deps.executableExists ?? existsSync;
  const spawnHelper = deps.spawnHelper ?? ((path: string) =>
    spawn(path, [], { stdio: ["ignore", "pipe", "pipe"] }) as unknown as InputTapProcess);
  let childProcess: InputTapProcess | null = null;

  function start(): void {
    if (platform !== "darwin" || childProcess) return;
    if (!executableExists(deps.executablePath)) {
      deps.onError(`macOS input tap helper missing at ${deps.executablePath}`);
      return;
    }

    const child = spawnHelper(deps.executablePath);
    childProcess = child;
    let stdoutBuffer = "";

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        try {
          deps.onMessage(JSON.parse(line));
        } catch (error) {
          deps.onError("Failed to parse macOS input tap message:", error);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      deps.onError("macOS input tap stderr:", chunk.toString("utf8"));
    });

    child.on("exit", (code, signal) => {
      if (childProcess === child) childProcess = null;
      deps.onError(
        `macOS input tap exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
      );
    });
  }

  function stop(): void {
    const child = childProcess;
    childProcess = null;
    child?.kill();
  }

  return { start, stop };
}
