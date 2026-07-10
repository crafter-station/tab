import { existsSync } from "node:fs";
import { resolve } from "node:path";

const desktop = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);

if (args.includes("--help")) {
  console.log(`Usage: bun apps/desktop/benchmarks/run.ts [options]

  --runtime llama|mlx|coreml
  --scenario smoke|screen|quality|quality-candidate|calibrate|calibrate-agent|quality-ceiling|soak
  --model /absolute/model/path
  --reference-model provider/model (repeat up to twice)
  --results /absolute/content-free-results.json
  --port local llama-server port (default: 39281)
  --quality-local-only

Environment:
  TAB_BENCH_LLAMA_SERVER  llama-server executable
  TAB_BENCH_LLAMA_PORT    local llama-server port
  TAB_BENCH_MLX_HELPER    built MLX helper executable
  TAB_BENCH_COREML_HELPER built Core ML helper executable

The benchmark never persists prompts, Personal Memory content, or generated text.`);
  process.exit(0);
}

const preload = resolve(desktop, "dist/preload.cjs");
const overlay = resolve(desktop, "dist/renderer/overlay.html");

for (const [script, output] of [["build:preload", preload], ["build:renderer", overlay]] as const) {
  if (existsSync(output)) continue;
  const result = Bun.spawnSync(["bun", "run", "--cwd", desktop, script], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

const electron = resolve(desktop, "node_modules/.bin/electron");
const child = Bun.spawn(
  [electron, resolve(import.meta.dir, "electron-main.cjs"), ...args],
  {
    cwd: desktop,
    env: { ...process.env, TAB_BENCH_PRELOAD: preload, TAB_BENCH_OVERLAY: overlay },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

process.exit(await child.exited);
