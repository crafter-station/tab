import { describe, expect, it } from "bun:test";
import { createWebApp } from "../apps/web/src/index.ts";

describe("Web font assets", () => {
  it("serves the shared variable fonts referenced by generated CSS", async () => {
    const webApp = createWebApp({ apiBaseUrl: "http://localhost:8787" });

    for (const font of [
      "geist-latin-wght-normal.woff2",
      "space-grotesk-latin-wght-normal.woff2",
    ]) {
      const response = await webApp.fetch(new Request(`http://localhost:3000/files/${font}`));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("font/woff2");
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  });
});
