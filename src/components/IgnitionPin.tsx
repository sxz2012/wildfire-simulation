import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  VerticalOrigin,
  HeightReference,
  Color,
  Entity,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";

interface IgnitionPinProps {
  viewer: CesiumViewer | null;
  position: { lat: number; lng: number } | null;
}

/**
 * Build a small flame-shaped pin used as the placeable ignition marker.
 * Drawn at twice display size for crisp billboards on high-DPI screens.
 */
function createPinImage(): HTMLCanvasElement {
  const w = 64;
  const h = 80;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return c;

  // Soft drop shadow under the flame so it reads against busy terrain.
  ctx.shadowBlur = 6;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowOffsetY = 3;

  const cx = w / 2;

  // Outer flame body — fire-orange with darker outline.
  ctx.beginPath();
  ctx.moveTo(cx, 6);
  ctx.bezierCurveTo(cx - 14, 22, cx - 24, 38, cx - 24, 52);
  ctx.bezierCurveTo(cx - 24, 68, cx - 14, 76, cx, 76);
  ctx.bezierCurveTo(cx + 14, 76, cx + 24, 68, cx + 24, 52);
  ctx.bezierCurveTo(cx + 24, 38, cx + 16, 28, cx + 10, 20);
  ctx.bezierCurveTo(cx + 4, 30, cx - 4, 28, cx, 6);
  ctx.closePath();
  ctx.fillStyle = "#ff5722";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#a82500";
  ctx.stroke();

  // Drop shadow only under the outer body — kill it for the inner glow.
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Inner flame — bright yellow core.
  ctx.beginPath();
  ctx.moveTo(cx, 30);
  ctx.bezierCurveTo(cx - 9, 42, cx - 14, 52, cx - 14, 60);
  ctx.bezierCurveTo(cx - 14, 70, cx - 6, 73, cx, 73);
  ctx.bezierCurveTo(cx + 6, 73, cx + 14, 70, cx + 14, 60);
  ctx.bezierCurveTo(cx + 14, 52, cx + 6, 44, cx, 30);
  ctx.closePath();
  ctx.fillStyle = "#ffd54f";
  ctx.fill();

  return c;
}

/**
 * Static flame marker shown at the user's chosen ignition point before the
 * simulation starts. Re-renders smoothly when the user moves the pin by
 * clicking a new spot — Cesium swaps the entity's position in place.
 */
export default function IgnitionPin({ viewer, position }: IgnitionPinProps) {
  const entityRef = useRef<Entity | null>(null);
  const pinImage = useMemo(createPinImage, []);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !position) return;

    const entity = viewer.entities.add({
      position: Cartesian3.fromDegrees(position.lng, position.lat, 0),
      billboard: {
        image: pinImage,
        width: 36,
        height: 45,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        color: Color.WHITE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    entityRef.current = entity;

    return () => {
      if (viewer && !viewer.isDestroyed() && entityRef.current) {
        viewer.entities.remove(entityRef.current);
      }
      entityRef.current = null;
    };
  }, [viewer, position, pinImage]);

  return null;
}
