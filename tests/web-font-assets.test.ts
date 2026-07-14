import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

describe("Web font assets", () => {
  it("serves the shared variable fonts referenced by generated CSS", async () => {
    for (const font of [
      "geist-latin-wght-normal.woff2",
      "space-grotesk-latin-wght-normal.woff2",
    ]) {
      const packageName = font.startsWith("geist-") ? "geist" : "space-grotesk";
      const file = Bun.file(`node_modules/@fontsource-variable/${packageName}/files/${font}`);
      expect(await file.exists()).toBe(true);
      expect(file.size).toBeGreaterThan(0);
    }
    const styles = readFileSync("packages/ui/src/styles/globals.css", "utf8");
    expect(styles).toContain('@import "@fontsource-variable/geist"');
    expect(styles).toContain('@import "@fontsource-variable/space-grotesk"');
  });
});
