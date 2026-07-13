import { describe, it, expect } from "bun:test";
import { createWebApp, type WebApp } from "../apps/web/src/index.ts";

function webRequest(
  webApp: WebApp,
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  const request = new Request(`http://localhost:3000${pathname}`, init);
  return webApp.fetch(request);
}

function expectMotionRegion(body: string, id: string): void {
  expect(body).toMatch(
    new RegExp(`<div(?=[^>]*id="${id}")(?=[^>]*data-motion-region(?:=""|="true")?(?=[\\s>]))(?=[^>]*data-motion-paused="false")[^>]*>`),
  );
  expect(body).toMatch(
    new RegExp(`<button(?=[^>]*data-motion-toggle(?:=""|="true")?(?=[\\s>]))(?=[^>]*aria-controls="${id}")(?=[^>]*aria-pressed="false")[^>]*>(?:(?!</button>)[^])*?<span[^>]*data-motion-toggle-label(?:=""|="true")?(?=[\\s>])[^>]*>Pause animation</span>(?:(?!</button>)[^])*?</button>`),
  );
}

describe("Web download surface", () => {
  it("redirects /download/tab.dmg to the configured macOS artifact URL", async () => {
    const webApp = createWebApp({
      apiBaseUrl: "http://localhost:8787",
      macDownloadUrl: "https://cdn.example.com/tab-0.2.0.dmg",
    });

    const response = await webRequest(webApp, "/download/tab.dmg");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://cdn.example.com/tab-0.2.0.dmg",
    );
  });

  it("serves /download/latest.json with the current version and artifact URL", async () => {
    const webApp = createWebApp({
      apiBaseUrl: "http://localhost:8787",
      macDownloadUrl: "https://cdn.example.com/tab-0.2.0.dmg",
      latestVersion: "0.2.0",
    });

    const response = await webRequest(webApp, "/download/latest.json");

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
    const webApp = createWebApp({
      apiBaseUrl: "http://localhost:8787",
      macDownloadUrl: "https://cdn.example.com/tab-0.2.0.dmg",
    });

    const response = await webRequest(webApp, "/download");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude("/download/tab.dmg");
  });

  it("renders a direct, interactive landing-page funnel", async () => {
    const webApp = createWebApp({
      apiBaseUrl: "http://localhost:8787",
      macDownloadUrl: "https://cdn.example.com/tab-0.2.0.dmg",
    });

    const response = await webRequest(webApp, "/");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toInclude('href="/download/tab.dmg"');
    expect(body).toInclude("Writing with AI should not mean leaving the sentence");
    expect(body).toInclude("data-tab-workflow");
    expect(body).toInclude("data-workflow-accept");
    expect(body).toInclude("Suggestions that remember what matters");
    expect(body).toInclude("Useful context in. Raw typing logs out.");
    expect(body).toInclude("data-animated-showcase");
    expect(body).toInclude("data-showcase-replay");
    expectMotionRegion(body, "app-marquee-animation");
    expectMotionRegion(body, "memory-showcase-animation");
    expectMotionRegion(body, "privacy-showcase-animation");
    expect(body).toInclude('src="/marketing-demo.js?v=motion-controls"');
    expect(body).toInclude('id="pricing"');
  });
});
