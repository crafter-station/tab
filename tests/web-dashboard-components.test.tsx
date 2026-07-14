import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Checkbox } from "../packages/ui/src/index.ts";
import { allowancePercentage } from "../apps/web/src/components/dashboard/shared.tsx";

describe("hydrated dashboard component architecture", () => {
  it("keeps the Radix checkbox associated with the native bulk form", () => {
    const markup = renderToStaticMarkup(
      <div>
        <form id="bulk-delete" action="/dashboard/memories/delete-selected" method="post" />
        <Checkbox form="bulk-delete" name="memoryId" value="memory-1" defaultChecked />
      </div>,
    );

    expect(markup).toInclude('form="bulk-delete"');
    expect(markup).toInclude('name="memoryId"');
    expect(markup).toInclude('value="memory-1"');
    expect(markup).toInclude('type="checkbox"');
    expect(markup).toInclude("checked");
  });

  it("does not retain static dashboard or details-menu forks", () => {
    const dashboardSources = [
      "apps/web/src/components/pages/dashboard.tsx",
      "apps/web/src/components/dashboard/layout.tsx",
      "apps/web/src/components/dashboard/row-actions.tsx",
      "apps/web/src/components/dashboard/devices.tsx",
      "apps/web/src/components/dashboard/memories.tsx",
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    const menuSources = [
      "apps/web/src/components/brand-menu.tsx",
      "apps/web/src/components/site-shell.tsx",
      "apps/web/src/components/user-menu.tsx",
    ].map((path) => readFileSync(path, "utf8")).join("\n");

    expect(dashboardSources).not.toContain("DashboardStatic");
    expect(dashboardSources).not.toContain("TableActionMenu");
    expect(dashboardSources).not.toContain("sectionFromPathname");
    expect(menuSources).not.toContain("StaticBrandMenu");
    expect(menuSources).not.toContain("<details");
  });

  it("separates monthly activity from free-plan allowance usage", () => {
    const sources = [
      readFileSync("apps/web/src/components/dashboard/usage.tsx", "utf8"),
      readFileSync("apps/web/src/components/dashboard/shared.tsx", "utf8"),
    ].join("\n");

    expect(sources).toContain("Automatic Suggestions accepted");
    expect(sources).toContain("Words inserted");
    expect(sources).toContain("accepted words used today");
    expect(sources).toContain("words left");
    expect(sources).toContain("used this month");
    expect(sources).toContain("Deep Completes left");
    expect(sources).not.toContain("Words completed");
    expect(sources).not.toContain("Local Accepted Words today");
    expect(allowancePercentage({ used: 3, limit: 100, remaining: 97, resetAt: "2026-07-15T04:00:00.000Z", exhausted: false })).toBe(3);
  });

  it("shows paid users unlimited local usage without a false quota", () => {
    expect(allowancePercentage({ used: 3, limit: null, remaining: null, resetAt: "2026-07-15T04:00:00.000Z", exhausted: false })).toBeNull();
    const source = readFileSync("apps/web/src/components/dashboard/shared.tsx", "utf8");
    expect(source).toContain("accepted words today");
    expect(source).toContain('remaining={finite ?');
    expect(source).toContain('"Unlimited"');
    expect(source).toContain("No daily limit on");
  });
});
