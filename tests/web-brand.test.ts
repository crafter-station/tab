import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const brandSource = readFileSync(new URL("../apps/web/src/components/pages/brand.tsx", import.meta.url), "utf8");

describe("Web brand surface", () => {
  it("renders the public brand specimen and download ledger", async () => {
    const body = brandSource;

    expect(body).toInclude("A small, deliberate continuation.");
    expect(body).toInclude('<BrandSpecimen mode="light"');
    expect(body).toInclude('<BrandSpecimen mode="dark"');
    expect(body).toInclude("data-brand-specimen={mode}");
    expect(body.match(/href: "\/brand\//g)?.length).toBe(16);
    expect(body).toInclude('download="tab-brand-assets.zip"');
    expect(body).toInclude('filename: "tab-mark.svg"');
    expect(body).toInclude('filename: "tab-lockup-1600.png"');
    expect(body).toInclude('href: "/brand/tab-mark-dark.jpg"');
    expect(body).toInclude('href: "/brand/tab-mark-dark.svg"');
    expect(body).toInclude("brand-transparency-grid");
    expect(body).toInclude("Brand colors");
    expect(body).toInclude("Space Grotesk Bold");
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
      const file = Bun.file(`apps/web/public${path}`);
      expect(await file.exists()).toBe(true);
      expect(file.type).toInclude(contentType);
      expect(file.size).toBeGreaterThan(0);
    }

    expect(await Bun.file("apps/web/public/brand/unapproved.svg").exists()).toBe(false);
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
