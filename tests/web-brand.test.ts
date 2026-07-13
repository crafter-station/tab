import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createWebApp, type WebApp } from "../apps/web/src/index.ts";

function webRequest(webApp: WebApp, pathname: string): Promise<Response> {
  return webApp.fetch(new Request(`http://localhost:3000${pathname}`));
}

describe("Web brand surface", () => {
  const webApp = createWebApp({ apiBaseUrl: "http://localhost:8787" });

  it("renders the public brand specimen and download ledger", async () => {
    const response = await webRequest(webApp, "/brand");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toInclude("<title>Tab Brand Assets - Logos, colors, and usage</title>");
    expect(body).toInclude("A small, deliberate continuation.");
    expect(body).toInclude('data-brand-specimen="light"');
    expect(body).toInclude('data-brand-specimen="dark"');
    expect(body.match(/data-brand-download-preview=/g)?.length).toBe(16);
    expect(body).toInclude('download="tab-brand-assets.zip"');
    expect(body).toInclude('download="tab-mark.svg"');
    expect(body).toInclude('download="tab-lockup-1600.png"');
    expect(body).toInclude('href="/brand/tab-mark-dark.jpg"');
    expect(body).toInclude('href="/brand/tab-mark-dark.svg"');
    expect(body).toInclude("brand-transparency-grid");
    expect(body).toInclude("Brand colors");
    expect(body).toInclude("Space Grotesk Bold");
    expect(body).toInclude('href="/brand"');
  });

  it("serves each approved brand asset format with the correct media type", async () => {
    const assets = [
      ["/brand/tab-mark.svg", "image/svg+xml"],
      ["/brand/tab-mark.png", "image/png"],
      ["/brand/tab-mark.webp", "image/webp"],
      ["/brand/tab-mark-dark.svg", "image/svg+xml"],
      ["/brand/tab-mark-dark.png", "image/png"],
      ["/brand/tab-lockup-dark.webp", "image/webp"],
      ["/brand/tab-mark-dark.jpg", "image/jpeg"],
      ["/brand/tab-lockup-light.jpg", "image/jpeg"],
      ["/brand/tab-brand-assets.zip", "application/zip"],
    ] as const;

    for (const [path, contentType] of assets) {
      const response = await webRequest(webApp, path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toInclude(contentType);
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }

    expect((await webRequest(webApp, "/brand/unapproved.svg")).status).toBe(404);
  });

  it("keeps downloadable SVGs aligned with their canonical sources", () => {
    expect(readFileSync("apps/web/public/brand/tab-mark.svg", "utf8")).toBe(
      readFileSync("packages/ui/src/assets/brand/tab-mark.svg", "utf8"),
    );
    expect(readFileSync("apps/web/public/brand/tab-lockup.svg", "utf8")).toBe(
      readFileSync("packages/ui/src/assets/brand/tab-lockup.svg", "utf8"),
    );
    expect(readFileSync("apps/web/public/brand/tab-mark-dark.svg", "utf8")).toBe(
      readFileSync("packages/ui/src/assets/brand/tab-mark-dark.svg", "utf8"),
    );
    expect(readFileSync("apps/web/public/brand/tab-lockup-dark.svg", "utf8")).toBe(
      readFileSync("packages/ui/src/assets/brand/tab-lockup-dark.svg", "utf8"),
    );
  });
});
