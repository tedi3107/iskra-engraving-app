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
import { layoutCurvedText } from "../lib/curved-text";

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

// Offscreen 2D context used only to measure glyph widths — the same
// measureText() the storefront uses, so arc spacing matches it. Created
// lazily: this module is only ever loaded in the browser (see below).
let measureContext: CanvasRenderingContext2D | null | undefined;

function measureGlyphWidths(chars: string[], font: string): number[] {
  if (measureContext === undefined) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  const ctx = measureContext;
  if (!ctx) return chars.map(() => 0);
  ctx.font = font;
  return chars.map((ch) => ctx.measureText(ch).width);
}

// The only module that imports react-konva. Konva needs a real DOM/canvas, so
// app.position-designer.tsx loads this component with a dynamic import() and
// it never runs during server-side rendering.
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

  // Canvas doesn't redraw by itself when a web font finishes loading. The
  // parent bumps fontsReadyTick once per loaded font, and the layer redraws
  // then.
  useEffect(() => {
    layerRef.current?.batchDraw();
  }, [fontsReadyTick]);

  // Point the Transformer at the current shape node; switching
  // straight/curved swaps a Rect for a Circle.
  useEffect(() => {
    const node = rectRef.current ?? circleRef.current;
    if (node && trRef.current) {
      trRef.current.nodes([node]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [shape]);

  // fontSize is a percentage of the zone (box height or circle radius), not
  // of the image, the same as on the storefront.
  const fontSizePx =
    shape === "straight"
      ? (fontSize / 100) * geometry.height
      : (fontSize / 100) * geometry.radius;

  // Same layout as the storefront (lib/curved-text.ts mirrors
  // engraving-preview-core.js): centered on the arc midpoint, spaced by real
  // glyph widths. Recomputed on every render, so a font finishing loading
  // (fontsReadyTick) re-measures with the real face.
  const curvedChars = (() => {
    if (shape !== "curved") return [];
    const chars = Array.from(previewText);
    const widths = measureGlyphWidths(chars, `${fontSizePx}px ${fontFamily}`);
    return layoutCurvedText(
      widths,
      geometry.centerX,
      geometry.centerY,
      geometry.radius,
      geometry.startAngle,
      geometry.arcLength,
    ).map((placement, i) => ({
      char: chars[i],
      width: widths[i],
      x: placement.x,
      y: placement.y,
      rotation: placement.angle + 90,
    }));
  })();

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
                offsetX={c.width / 2}
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
