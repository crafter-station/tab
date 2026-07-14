import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Checkbox } from "../packages/ui/src/index.ts";

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
});
