import { describe, expect, it } from "vitest";
import { isBottomHalfArc, layoutCurvedText } from "./curved-text";
import { loadStorefrontCore } from "../test-utils/load-storefront-core";

const core = loadStorefrontCore();
const cx = 200;
const cy = 200;
const r = 120;

describe("layoutCurvedText", () => {
  it("returns nothing for empty text", () => {
    expect(layoutCurvedText([], cx, cy, r, 200, 140)).toEqual([]);
  });

  it("centers a single character on the arc midpoint", () => {
    const [c] = layoutCurvedText([20], cx, cy, r, 200, 140); // mid = 270° (top)
    expect(c.angle).toBeCloseTo(270, 9);
    expect(c.x).toBeCloseTo(cx, 9);
    expect(c.y).toBeCloseTo(cy - r, 9);
  });

  it("spaces characters by their real widths, symmetric around the midpoint", () => {
    const out = layoutCurvedText([10, 30, 10], cx, cy, r, 200, 140);
    expect(out[1].angle).toBeCloseTo(270, 9);
    expect(270 - out[0].angle).toBeCloseTo(out[2].angle - 270, 9);
    // wider middle glyph pushes neighbours further out than equal widths would
    const even = layoutCurvedText([10, 10, 10], cx, cy, r, 200, 140);
    expect(270 - out[0].angle).toBeGreaterThan(270 - even[0].angle);
  });

  it("runs the other way on the bottom half so text stays upright", () => {
    expect(isBottomHalfArc(20, 140)).toBe(true);
    expect(isBottomHalfArc(200, 140)).toBe(false);
    const out = layoutCurvedText([10, 10], cx, cy, r, 20, 140); // mid = 90° (bottom)
    expect(out[0].angle).toBeGreaterThan(out[1].angle);
  });

  it("keeps every character on the circle", () => {
    for (const p of layoutCurvedText([12, 8, 15, 9, 11], cx, cy, r, 190, 160)) {
      expect(Math.hypot(p.x - cx, p.y - cy)).toBeCloseTo(r, 9);
    }
  });
});

describe("parity with the storefront (engraving-preview-core.js)", () => {
  // Deterministic pseudo-random cases covering top/bottom halves, wrap-around
  // angles and very different glyph widths.
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

  it("produces exactly the same placements for 200 random layouts", () => {
    for (let i = 0; i < 200; i++) {
      const widths = Array.from({ length: 1 + Math.floor(rand() * 20) }, () => 2 + rand() * 40);
      const start = rand() * 720 - 360;
      const arc = 10 + rand() * 350;
      const radius = 20 + rand() * 400;
      expect(layoutCurvedText(widths, cx, cy, radius, start, arc)).toEqual(
        core.layoutCurvedText(widths, cx, cy, radius, start, arc),
      );
      expect(isBottomHalfArc(start, arc)).toBe(core.isBottomHalfArc(start, arc));
    }
  });
});
