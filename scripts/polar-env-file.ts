import { chmod, rename, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "./env.ts";

export function getPolarEnvFile(argv = process.argv.slice(2)): string {
  const inline = argv.find((arg) => arg.startsWith("--env-file="));
  const flagIndex = argv.indexOf("--env-file");
  const value = inline?.slice("--env-file=".length) ??
    (flagIndex >= 0 ? argv[flagIndex + 1] : undefined);
  const envFile = resolve(value ?? ".dev.vars");
  const productionFile = envFile.endsWith("dev.vars.prod");
  if (productionFile !== (env.POLAR_SERVER === "production")) {
    throw new Error(
      `Refusing to use ${env.POLAR_SERVER} Polar with ${envFile}`,
    );
  }
  return envFile;
}

export async function updatePolarEnvFile(
  envFile: string,
  values: Record<string, string>,
): Promise<void> {
  const input = await Bun.file(envFile).text();
  const pending = new Map(Object.entries(values));
  const lines = input.replaceAll("\r\n", "\n").replace(/\n$/, "").split("\n");
  const output = lines.map((line) => {
    const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
    if (!key || !pending.has(key)) return line;
    const replacement = `${key}=${pending.get(key)}`;
    pending.delete(key);
    return replacement;
  });
  if (pending.size > 0 && output.at(-1) !== "") output.push("");
  for (const [key, value] of pending) output.push(`${key}=${value}`);

  const temporaryPath = `${envFile}.tmp-${crypto.randomUUID()}`;
  try {
    const originalMode = (await stat(envFile)).mode & 0o777;
    await Bun.write(temporaryPath, `${output.join("\n")}\n`);
    await chmod(temporaryPath, originalMode);
    await rename(temporaryPath, envFile);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
