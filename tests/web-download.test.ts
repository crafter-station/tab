import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { downloadMetadata, downloadRedirect } from "../apps/web/src/lib/download.ts";

const downloadInfo = { version: "0.2.0", url: "https://cdn.example.com/tab-0.2.0.dmg", notes: "" };
const homeSource = readFileSync(new URL("../apps/web/src/components/pages/home.tsx", import.meta.url), "utf8");
const marketingSource = readFileSync(new URL("../apps/web/src/components/pages/marketing.tsx", import.meta.url), "utf8");
const autocompleteSource = readFileSync(new URL("../apps/web/src/components/marketing/autocomplete-demo.tsx", import.meta.url), "utf8");
const controlsSource = readFileSync(new URL("../apps/web/src/components/marketing/controls.tsx", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../apps/web/src/components/marketing/workflow-interaction.tsx", import.meta.url), "utf8");
const pricingSource = readFileSync(new URL("../apps/web/src/components/pricing/pricing-plan-card.tsx", import.meta.url), "utf8");

describe("Web download surface", () => {
  it("redirects /download/tab.dmg to the configured macOS artifact URL", async () => {
    const response = downloadRedirect(downloadInfo);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://cdn.example.com/tab-0.2.0.dmg",
    );
  });

  it("serves /download/latest.json with the current version and artifact URL", async () => {
    const response = downloadMetadata(downloadInfo);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toInclude("application/json");
    const body = (await response.json()) as {
      version: string;
      url: string;
      notes?: string;
    };
    expect(body.version).toBe("0.2.0");
    expect(body.url).toBe("https://cdn.example.com/tab-0.2.0.dmg");
  });

  it("download page links to the .dmg route", async () => {
    expect(marketingSource).toInclude("/download/tab.dmg");
  });

  it("renders a direct, interactive landing-page funnel", async () => {
    const body = homeSource;
    expect(body).toInclude('href="/download/tab.dmg"');
    expect(body).toInclude("Finish the sentence without leaving the app");
    expect(autocompleteSource).toInclude("data-tab-demo");
    expect(autocompleteSource).toInclude("Interactive example");
    expect(body).toInclude('id="how-it-works"');
    expect(body).toInclude("Built for standard Mac text fields");
    expect(body).toInclude("Local unless you ask for the cloud");
    expect(workflowSource).toInclude("data-tab-workflow");
    expect(body).toInclude("data-animated-showcase");
    expect(body).toInclude('id="workflow-animation"');
    expect(body).toInclude('id="app-marquee-animation"');
    expect(body).toInclude('id="memory-showcase-animation"');
    expect(body).toInclude('id="privacy-showcase-animation"');
    expect(controlsSource).toInclude("Pause animation");
    expect((body.match(/data-motion-region/g)?.length ?? 0) + (workflowSource.match(/data-motion-region/g)?.length ?? 0)).toBe(3);
    expect(body).not.toInclude("marketing-demo.js");
    expect(body).toInclude("AutocompleteDemo");
    expect(body).toInclude("MotionToggle");
    expect(body).toInclude('id="pricing"');
    expect(pricingSource).toInclude("data-pricing-plan");
    expect(body).toInclude("formatCount(max.deepCompletesPerMonth)");
    expect(body).toInclude("formatMonthlyPrice(max.monthlyPriceUsd)");
    expect(body).not.toInclude("/year");
    expect(body.match(/name: \"(?:Free|Pro|Max)\" as const/g)?.length).toBe(3);
  });
});
