import { describe, expect, it } from "bun:test";
import { boundsEqual } from "../apps/desktop/src/main/window-position.ts";

describe("desktop window positioning", () => {
  it("distinguishes unchanged and changed bounds", () => {
    const bounds = { x: 10, y: 20, width: 300, height: 48 };

    expect(boundsEqual(bounds, { ...bounds })).toBe(true);
    expect(boundsEqual(bounds, { ...bounds, x: 11 })).toBe(false);
    expect(boundsEqual(bounds, { ...bounds, height: 49 })).toBe(false);
  });
});
