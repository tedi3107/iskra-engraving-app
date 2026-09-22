import { useEffect, useRef } from "react";
import {
  Circle,
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import type Konva from "konva";

type PixelGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  arcLength: number;
};

type EngravingCanvasProps = {
  image: HTMLImageElement;
  shape: "straight" | "curved";
  geometry: PixelGeometry;
  displayWidth: number;
  displayHeight: number;
  scale: number;
  previewText: string;
  fontFamily: string;
  fontSize: number;
  fontsReadyTick: number;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
};

// Places each character of `text` along a circular arc, the same way the
// storefront's SVG textPath does it — but computed by hand here, since
// Konva has no built-in text-on-a-path. Angles follow the same convention
// used everywhere else in this app: 0° is the rightmost point of the circle
// (3 o'clock), increasing clockwise.
//
// Text drawn across the *bottom* half of the circle in the same direction
// the angle increases would come out upside down (walk along the underside
// of an arc and "up" points toward the circle's center, not away from it).
// Reversing the direction of travel for that half — without changing where
// the arc actually is — keeps every letter right-side up and outward-facing
// no matter where around the ring it's placed.
function getCurvedCharPlacements(
  text: string,
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  arcLength: number,
) {
  const chars = Array.from(text);
  const count = chars.length;
  if (count === 0) return [];

  const midAngle = (((startAngle + arcLength / 2) % 360) + 360) % 360;
  const isBottomHalf = midAngle > 0 && midAngle < 180;
  const effectiveStart = isBottomHalf ? startAngle + arcLength : startAngle;
  const effectiveArc = isBottomHalf ? -arcLength : arcLength;

  return chars.map((char, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = effectiveStart + effectiveArc * t;
    const rad = (angle * Math.PI) / 180;
    return {
      char,
      x: centerX + radius * Math.cos(rad),
      y: centerY + radius * Math.sin(rad),
      rotation: angle + 90,
    };
  });
}

// This file is the ONLY place that imports react-konva. Konva touches the
// DOM/canvas directly, so importing it at the top of a route module would
// make the dev server try to load it during server-side rendering too —
// that's what "Cannot find module 'canvas'" was. Loading this component only
// via a dynamic import() inside a useEffect (see app.position-designer.tsx)
// keeps it out of the server bundle entirely.
export default function EngravingCanvas({
  image,
  shape,
  geometry,
  displayWidth,
  displayHeight,
  scale,
  previewText,
  fontFamily,
  fontSize,
  fontsReadyTick,
  onDragEnd,
  onTransformEnd,
}: EngravingCanvasProps) {
  const rectRef = useRef<Konva.Rect>(null);
  const circleRef = useRef<Konva.Circle>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);

  // Canvas (which Konva draws onto) doesn't repaint itself when a font
  // finishes loading the way regular HTML text does — the FontFace the
  // parent asked the browser to load can become available seconds after
  // the first draw, and without this the previous fallback font just stays
  // on screen until something unrelated happens to trigger a redraw (like
  // switching fonts and back). fontsReadyTick comes from the parent and
  // bumps once per font that finishes loading; reacting to it here (rather
  // than a page-wide DOM event) means there's no window where a font could
  // finish loading before anything is listening — React guarantees this
  // effect runs after the prop change, whenever that change happens.
  useEffect(() => {
    layerRef.current?.batchDraw();
  }, [fontsReadyTick]);

  // Both the shape node and the Transformer are created right here, in this
  // one component, so by the time this effect runs after the first commit
  // both refs are guaranteed to be populated. Re-running when `shape`
  // changes matters too: switching between straight and curved swaps in a
  // completely different Konva node (a Rect vs a Circle), so the Transformer
  // needs to be pointed at the new one.
  useEffect(() => {
    const node = rectRef.current ?? circleRef.current;
    if (node && trRef.current) {
      trRef.current.nodes([node]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [shape]);

  // fontSize is a percentage of the zone's own size — its height for a box,
  // its radius for a circle — not of the whole image. That keeps it
  // meaningful regardless of how big the zone is relative to the image (a
  // small zone on a large product photo needs the same treatment as a large
  // one), and matches how the storefront computes it.
  const fontSizePx =
    shape === "straight"
      ? (fontSize / 100) * geometry.height
      : (fontSize / 100) * geometry.radius;

  const curvedChars =
    shape === "curved"
      ? getCurvedCharPlacements(
          previewText,
          geometry.centerX,
          geometry.centerY,
          geometry.radius,
          geometry.startAngle,
          geometry.arcLength,
        )
      : [];

  return (
    <Stage width={displayWidth} height={displayHeight}>
      <Layer ref={layerRef} scaleX={scale} scaleY={scale}>
        <KonvaImage image={image} />
        {shape === "straight" ? (
          <>
            <Rect
              ref={rectRef}
              x={geometry.x}
              y={geometry.y}
              width={geometry.width}
              height={geometry.height}
              fill="rgba(20,20,20,0.12)"
              stroke="#202020"
              strokeWidth={2 / scale}
              dash={[6 / scale, 6 / scale]}
              draggable
              onDragEnd={onDragEnd}
              onTransformEnd={onTransformEnd}
            />
            <Text
              text={previewText}
              x={geometry.x}
              y={geometry.y}
              width={geometry.width}
              height={geometry.height}
              align="center"
              verticalAlign="middle"
              fontFamily={fontFamily}
              fontSize={fontSizePx}
              fill="#202020"
              listening={false}
            />
          </>
        ) : (
          <>
            <Circle
              ref={circleRef}
              x={geometry.centerX}
              y={geometry.centerY}
              radius={geometry.radius}
              fill="rgba(20,20,20,0.08)"
              stroke="#202020"
              strokeWidth={2 / scale}
              dash={[6 / scale, 6 / scale]}
              draggable
              onDragEnd={onDragEnd}
              onTransformEnd={onTransformEnd}
            />
            {curvedChars.map((c, i) => (
              <Text
                key={i}
                text={c.char}
                x={c.x}
                y={c.y}
                offsetX={fontSizePx / 4}
                offsetY={fontSizePx / 2}
                rotation={c.rotation}
                fontFamily={fontFamily}
                fontSize={fontSizePx}
                fill="#202020"
                listening={false}
              />
            ))}
          </>
        )}
        <Transformer
          ref={trRef}
          rotateEnabled={false}
          keepRatio={shape === "curved"}
          enabledAnchors={
            shape === "curved"
              ? ["top-left", "top-right", "bottom-left", "bottom-right"]
              : undefined
          }
          anchorSize={1 / scale}
          anchorStrokeWidth={1 / scale}
          borderStrokeWidth={1 / scale}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
          }
        />
      </Layer>
    </Stage>
  );
}
