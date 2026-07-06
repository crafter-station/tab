import { mkdirSync } from "node:fs";
import path from "node:path";

const desktopRoot = path.resolve(import.meta.dir, "..");
const outPath = process.argv[2] ?? path.join(desktopRoot, "dist", "macos-input-tap");

if (process.platform !== "darwin") {
  console.log("Skipping macOS native input tap build on non-macOS platform.");
  process.exit(0);
}

mkdirSync(path.dirname(outPath), { recursive: true });

await Bun.$`swiftc ${path.join(desktopRoot, "native", "macos-input-tap.swift")} -o ${outPath} -framework AppKit -framework ApplicationServices`;
console.log(`Built macOS input tap at ${outPath}`);
