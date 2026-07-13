import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const desktopRoot = path.resolve(import.meta.dir, "..");
const outPath = process.argv[2] ?? path.join(desktopRoot, "dist", "macos-input-tap");

if (process.platform !== "darwin") {
  console.log("Skipping macOS native input tap build on non-macOS platform.");
  process.exit(0);
}

mkdirSync(path.dirname(outPath), { recursive: true });

const sourcePath = path.join(desktopRoot, "native", "macos-input-tap.swift");
const tempDir = mkdtempSync(path.join(tmpdir(), "tab-native-"));
const arm64Path = path.join(tempDir, "macos-input-tap-arm64");
const x64Path = path.join(tempDir, "macos-input-tap-x64");

try {
  await Bun.$`swiftc ${sourcePath} -target arm64-apple-macosx11.0 -o ${arm64Path} -framework AppKit -framework ApplicationServices`;
  await Bun.$`swiftc ${sourcePath} -target x86_64-apple-macosx11.0 -o ${x64Path} -framework AppKit -framework ApplicationServices`;
  await Bun.$`lipo -create ${arm64Path} ${x64Path} -output ${outPath}`;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log(`Built universal macOS input tap at ${outPath}`);
