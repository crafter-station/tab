import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { PersonalMemory } from "@tab/contracts";
import { DeviceRowActions, MemoryRowActions } from "../apps/web/src/components/dashboard/row-actions.tsx";
import { MemoryBulkNoscriptFallback } from "../apps/web/src/components/dashboard/memories.tsx";

const memory: PersonalMemory = {
  id: "memory-1",
  userId: "user-1",
  content: "Prefers concise summaries",
  createdBy: "user",
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z",
};

describe("SSR UI structure contracts", () => {
  it("composes dialog content with header, title, and description primitives", () => {
    const source = readFileSync(new URL("../packages/ui/src/components/ui/dialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("<DialogPortal>");
    expect(source).toContain("<DialogPrimitive.Content");
    expect(source).toContain("{children}");
    expect(source).toContain("<DialogPrimitive.Title");
    expect(source).toContain("<DialogPrimitive.Description");
  });

  it("renders native no-JS device and memory mutation forms", () => {
    const markup = renderToStaticMarkup(
      <div>
        <DeviceRowActions deviceId="mac/device" />
        <MemoryRowActions memory={memory} label="Memory actions" />
      </div>,
    );

    expect(markup).toContain("<noscript>");
    expect(markup).toContain('method="post"');
    expect(markup).toContain('action="/dashboard/devices/mac%2Fdevice/revoke"');
    expect(markup).toContain('name="confirm" value="mac/device"');
    expect(markup).toContain('action="/dashboard/memories/memory-1/edit"');
    expect(markup).toContain('name="content"');
    expect(markup).toContain('action="/dashboard/memories/memory-1/delete"');
    expect(markup).toContain('name="confirm" value="delete-memory"');
  });

  it("renders a native no-JS bulk memory form", () => {
    const markup = renderToStaticMarkup(
      <MemoryBulkNoscriptFallback memories={[memory]} />,
    );

    expect(markup).toContain('action="/dashboard/memories/delete-selected"');
    expect(markup).toContain('method="post"');
    expect(markup).toContain('type="checkbox" name="memoryId" value="memory-1"');
    expect(markup).toContain('name="confirm" value="delete-selected-memories"');
    expect(markup).toContain("Delete selected memories");
  });
});
