// Curved (ring) text layout for the admin Position designer.
//
// This is a TypeScript port of layoutCurvedText in
// extensions/engraving-preview/assets/engraving-preview-core.js — the exact
// function the storefront uses — so the admin preview places letters where
// customers will see them. curved-text.test.ts loads the storefront file and
// asserts both produce identical output, so the two cannot drift apart.
//
// Angles: 0° is 3 o'clock, increasing clockwise. The text is centered on the
// arc's midpoint (startAngle + arcLength / 2) and laid out by each
// character's real advance width; on the bottom half the direction of travel
// is reversed so letters stay upright and outward-facing.

export type CurvedPlacement = { x: number; y: number; angle: number };

const RAD_TO_DEG = 180 / Math.PI;

export function isBottomHalfArc(startDeg: number, arcDeg: number): boolean {
  const midAngle = (((startDeg + arcDeg / 2) % 360) + 360) % 360;
  return midAngle > 0 && midAngle < 180;
}

export function layoutCurvedText(
  charWidths: number[],
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  arcDeg: number,
): CurvedPlacement[] {
  const totalWidth = charWidths.reduce((a, b) => a + b, 0);
  const totalAngleDeg = (totalWidth / r) * RAD_TO_DEG;
  const directionSign = isBottomHalfArc(startDeg, arcDeg) ? -1 : 1;
  const centerAngle = startDeg + arcDeg / 2;
  let cursorAngle = centerAngle - directionSign * (totalAngleDeg / 2);

  return charWidths.map((width) => {
    const halfCharAngle = (width / 2 / r) * RAD_TO_DEG;
    const angle = cursorAngle + directionSign * halfCharAngle;
    const rad = (angle * Math.PI) / 180;
    const placement = {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
      angle,
    };
    cursorAngle += directionSign * ((width / r) * RAD_TO_DEG);
    return placement;
  });
}
