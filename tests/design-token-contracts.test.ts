import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { PLATFORM_COLORS } from "../packages/ui/src/platform-colors.ts";

const sourceRoots = [
  "packages/ui/src",
  "apps/web/src",
  "apps/web/public",
  "apps/desktop/src",
  "apps/api/src/emails",
  "tailwind.config.ts",
] as const;

const sourceExtensions = new Set([".css", ".html", ".js", ".jsx", ".svg", ".swift", ".ts", ".tsx"]);
const tokenDefinitionFiles = new Set([
  "packages/ui/src/platform-colors.ts",
  "packages/ui/src/styles/globals.css",
]);
const fixedBrandExportFiles = new Set([
  "packages/ui/src/assets/brand/tab-mark-dark.svg",
  "packages/ui/src/assets/brand/tab-lockup-dark.svg",
  "apps/web/public/brand/tab-mark-dark.svg",
  "apps/web/public/brand/tab-lockup-dark.svg",
]);

function collectSourceFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return sourceExtensions.has(extname(path)) ? [path] : [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && entry.name === "generated") return [];
    const child = join(path, entry.name);
    return entry.isDirectory() ? collectSourceFiles(child) : sourceExtensions.has(extname(child)) ? [child] : [];
  });
}

function parseTokens(source: string): Map<string, string> {
  return new Map([...source.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
}

function tokenValue(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

describe("design token contracts", () => {
  it("keeps platform colors synchronized with the canonical CSS themes", () => {
    const css = readFileSync("packages/ui/src/styles/globals.css", "utf8");
    const light = parseTokens(css.slice(css.indexOf(":root,"), css.indexOf(".dark,")));
    const dark = parseTokens(css.slice(css.indexOf(".dark,"), css.indexOf("@media (prefers-color-scheme: dark)")));
    const systemDarkStart = css.indexOf(":root:not([data-theme=\"light\"])");
    const systemDark = parseTokens(css.slice(systemDarkStart, css.indexOf("\n}\n\n:root,", systemDarkStart)));

    expect(PLATFORM_COLORS.theme.light.background).toBe(tokenValue(light, "--background"));
    expect(PLATFORM_COLORS.theme.light.canvas).toBe(tokenValue(light, "--tab-canvas"));
    expect(PLATFORM_COLORS.theme.light.foreground).toBe(tokenValue(light, "--foreground"));
    expect(PLATFORM_COLORS.theme.light.mutedForeground).toBe(tokenValue(light, "--muted-foreground"));
    expect(PLATFORM_COLORS.theme.light.primary).toBe(tokenValue(light, "--primary"));
    expect(PLATFORM_COLORS.theme.light.primaryForeground).toBe(tokenValue(light, "--primary-foreground"));
    expect(PLATFORM_COLORS.theme.dark.background).toBe(tokenValue(dark, "--background"));
    expect(PLATFORM_COLORS.theme.dark.canvas).toBe(tokenValue(dark, "--tab-canvas"));
    expect(PLATFORM_COLORS.theme.dark.foreground).toBe(tokenValue(dark, "--foreground"));
    expect(PLATFORM_COLORS.theme.dark.mutedForeground).toBe(tokenValue(dark, "--muted-foreground"));
    expect(PLATFORM_COLORS.theme.dark.primary).toBe(tokenValue(dark, "--primary"));
    expect(PLATFORM_COLORS.theme.dark.primaryForeground).toBe(tokenValue(dark, "--primary-foreground"));
    expect(Object.fromEntries(systemDark)).toEqual(Object.fromEntries(dark));
  });

  it("rejects hardcoded colors and non-token color recipes in product surfaces", () => {
    const files = sourceRoots.flatMap(collectSourceFiles);
    const violations: string[] = [];
    const rawColor = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\s*\(|\b(?:black|white|CanvasText)\b(?!-)/;
    const rawPaletteUtility = /\b(?:text|bg|border|ring|outline|fill|stroke|shadow|from|via|to|decoration|accent|caret)-(?:black|white|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)(?:-\d{2,3})?(?:\/[0-9]{1,3})?\b/;
    const defaultShadow = /(?:^|:)shadow(?:-(?:sm|md|lg|xl|2xl))?$/;

    for (const file of files) {
      const normalized = relative(".", file);
      const source = readFileSync(file, "utf8");
      const isTokenDefinition = tokenDefinitionFiles.has(normalized);
      const isFixedBrandExport = fixedBrandExportFiles.has(normalized);

      source.split("\n").forEach((line, index) => {
        const isCssTokenDeclaration = normalized.endsWith("globals.css") && /^\s*--[\w-]+\s*:/.test(line);
        if ((!isTokenDefinition && !isFixedBrandExport && rawColor.test(line)) || (normalized.endsWith("globals.css") && !isCssTokenDeclaration && rawColor.test(line))) {
          violations.push(`${normalized}:${index + 1} raw color`);
        }
        if (!isTokenDefinition && rawPaletteUtility.test(line)) {
          violations.push(`${normalized}:${index + 1} raw palette utility`);
        }
        if (!isTokenDefinition && line.includes("color-mix(")) {
          violations.push(`${normalized}:${index + 1} local color mix`);
        }
      });

      if (!isTokenDefinition && (normalized.endsWith(".ts") || normalized.endsWith(".tsx") || normalized.endsWith(".js") || normalized.endsWith(".jsx"))) {
        for (const token of source.split(/\s+/)) {
          const classToken = token.replace(/^[`"'({]+|[`"',)};]+$/g, "");
          if (defaultShadow.test(classToken)) violations.push(`${normalized} default shadow utility: ${classToken}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps fixed inverse SVG exports aligned with the warm-white platform token", () => {
    for (const file of fixedBrandExportFiles) {
      expect(readFileSync(file, "utf8")).toInclude(`fill="${PLATFORM_COLORS.theme.light.primaryForeground}"`);
    }
  });
});
