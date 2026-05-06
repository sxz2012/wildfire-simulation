import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  Color,
  PointPrimitiveCollection,
  BillboardCollection,
  VerticalOrigin,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import type { HistoricalFire } from "../data/historicalFires";

interface HistoricalFireOverlayProps {
  fire: HistoricalFire;
  currentFrame: number;
  viewer: CesiumViewer | null;
}

/** Draw a flame shape matching the fire emoji style */
function createFlameImage(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const h = size;

  // Outer flame — red
  ctx.beginPath();
  ctx.moveTo(cx, h * 0.02);
  ctx.bezierCurveTo(cx - size * 0.05, h * 0.25, cx - size * 0.4, h * 0.35, cx - size * 0.38, h * 0.6);
  ctx.bezierCurveTo(cx - size * 0.36, h * 0.78, cx - size * 0.25, h * 0.92, cx, h * 0.98);
  ctx.bezierCurveTo(cx + size * 0.25, h * 0.92, cx + size * 0.36, h * 0.78, cx + size * 0.38, h * 0.6);
  ctx.bezierCurveTo(cx + size * 0.4, h * 0.35, cx + size * 0.05, h * 0.25, cx, h * 0.02);
  ctx.closePath();
  const outerGrad = ctx.createLinearGradient(cx, 0, cx, h);
  outerGrad.addColorStop(0, "rgba(255, 60, 0, 0.9)");
  outerGrad.addColorStop(0.4, "rgba(220, 30, 0, 0.85)");
  outerGrad.addColorStop(1, "rgba(180, 20, 0, 0.7)");
  ctx.fillStyle = outerGrad;
  ctx.fill();

  // Inner flame — orange
  ctx.beginPath();
  ctx.moveTo(cx, h * 0.15);
  ctx.bezierCurveTo(cx - size * 0.03, h * 0.35, cx - size * 0.25, h * 0.45, cx - size * 0.22, h * 0.65);
  ctx.bezierCurveTo(cx - size * 0.2, h * 0.8, cx - size * 0.12, h * 0.9, cx, h * 0.95);
  ctx.bezierCurveTo(cx + size * 0.12, h * 0.9, cx + size * 0.2, h * 0.8, cx + size * 0.22, h * 0.65);
  ctx.bezierCurveTo(cx + size * 0.25, h * 0.45, cx + size * 0.03, h * 0.35, cx, h * 0.15);
  ctx.closePath();
  const innerGrad = ctx.createLinearGradient(cx, h * 0.15, cx, h * 0.95);
  innerGrad.addColorStop(0, "rgba(255, 160, 0, 0.9)");
  innerGrad.addColorStop(0.5, "rgba(255, 120, 0, 0.85)");
  innerGrad.addColorStop(1, "rgba(255, 80, 0, 0.6)");
  ctx.fillStyle = innerGrad;
  ctx.fill();

  // Core — yellow/white
  ctx.beginPath();
  ctx.moveTo(cx, h * 0.4);
  ctx.bezierCurveTo(cx - size * 0.02, h * 0.5, cx - size * 0.12, h * 0.6, cx - size * 0.1, h * 0.72);
  ctx.bezierCurveTo(cx - size * 0.08, h * 0.85, cx - size * 0.04, h * 0.92, cx, h * 0.95);
  ctx.bezierCurveTo(cx + size * 0.04, h * 0.92, cx + size * 0.08, h * 0.85, cx + size * 0.1, h * 0.72);
  ctx.bezierCurveTo(cx + size * 0.12, h * 0.6, cx + size * 0.02, h * 0.5, cx, h * 0.4);
  ctx.closePath();
  const coreGrad = ctx.createLinearGradient(cx, h * 0.4, cx, h * 0.95);
  coreGrad.addColorStop(0, "rgba(255, 255, 180, 0.95)");
  coreGrad.addColorStop(0.5, "rgba(255, 220, 80, 0.85)");
  coreGrad.addColorStop(1, "rgba(255, 180, 30, 0.5)");
  ctx.fillStyle = coreGrad;
  ctx.fill();

  return canvas;
}

function createSmokeImage(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(60, 60, 60, 0.7)");
  gradient.addColorStop(0.4, "rgba(40, 40, 40, 0.45)");
  gradient.addColorStop(1, "rgba(30, 30, 30, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

export default function HistoricalFireOverlay({
  fire,
  currentFrame,
  viewer,
}: HistoricalFireOverlayProps) {
  const burnedRef = useRef<PointPrimitiveCollection | null>(null);
  const flameRef = useRef<BillboardCollection | null>(null);
  const smokeRef = useRef<BillboardCollection | null>(null);

  const smokeImage = useMemo(() => createSmokeImage(), []);
  const flameImage = useMemo(() => createFlameImage(48), []);
  const flameImageSmall = useMemo(() => createFlameImage(32), []);

  const framePositions = useMemo(() => {
    return fire.frames.map((frame) =>
      frame.hotspots.map((h) => ({
        lat: h.lat,
        lng: h.lng,
        position: Cartesian3.fromDegrees(h.lng, h.lat, 300),
      }))
    );
  }, [fire]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // Cleanup
    if (burnedRef.current) viewer.scene.primitives.remove(burnedRef.current);
    if (flameRef.current) viewer.scene.primitives.remove(flameRef.current);
    if (smokeRef.current) viewer.scene.primitives.remove(smokeRef.current);
    burnedRef.current = null;
    flameRef.current = null;
    smokeRef.current = null;

    if (framePositions.length === 0) return;

    const burnedPoints = new PointPrimitiveCollection();
    const flameBillboards = new BillboardCollection();
    const smokeBillboards = new BillboardCollection();
    viewer.scene.primitives.add(burnedPoints);
    viewer.scene.primitives.add(flameBillboards);
    viewer.scene.primitives.add(smokeBillboards);
    burnedRef.current = burnedPoints;
    flameRef.current = flameBillboards;
    smokeRef.current = smokeBillboards;

    const windAngle = (Math.PI / 4) * 0.7;
    const driftLat = Math.cos(windAngle) * 0.008;
    const driftLng = Math.sin(windAngle) * 0.008;

    // Cap the historical-burn trail to the last 30 frames. Without this
    // bound, every step re-creates a primitive collection containing one
    // PointPrimitive per hotspot per past frame — for 100+ step playbacks
    // (resumed suppression sim) that's 50k+ GPU primitives destroyed and
    // rebuilt per step, which OOMs the tab.
    const HISTORICAL_FRAME_WINDOW = 30;
    const fStart = Math.max(0, currentFrame - HISTORICAL_FRAME_WINDOW);
    for (let f = fStart; f <= currentFrame && f < framePositions.length; f++) {
      const isCurrent = f === currentFrame;
      const hotspots = framePositions[f];

      if (isCurrent) {
        // Active fire — use flame billboards
        // Sample for large datasets
        const step = hotspots.length > 200 ? Math.ceil(hotspots.length / 200) : 1;

        for (let i = 0; i < hotspots.length; i++) {
          const h = hotspots[i];

          if (i % step === 0) {
            // Flame billboard with slight random variation
            const sizeVariation = 0.7 + Math.random() * 0.6;
            flameBillboards.add({
              position: Cartesian3.fromDegrees(h.lng, h.lat, 350),
              image: Math.random() > 0.3 ? flameImage : flameImageSmall,
              width: 18 * sizeVariation,
              height: 24 * sizeVariation,
              verticalOrigin: VerticalOrigin.BOTTOM,
              color: Color.WHITE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            });
          } else {
            // Smaller hotspot dot for density
            burnedPoints.add({
              position: h.position,
              pixelSize: 4,
              color: Color.fromCssColorString("#FF4500"),
              outlineColor: Color.fromCssColorString("#FF0000"),
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            });
          }
        }

        // Smoke for sampled positions
        const smokeStep = hotspots.length > 60 ? Math.ceil(hotspots.length / 60) : 1;
        for (let i = 0; i < hotspots.length; i += smokeStep) {
          const h = hotspots[i];
          for (let s = 1; s <= 2; s++) {
            const jLat = (Math.random() - 0.5) * 0.003;
            const jLng = (Math.random() - 0.5) * 0.003;
            smokeBillboards.add({
              position: Cartesian3.fromDegrees(
                h.lng + driftLng * s + jLng,
                h.lat + driftLat * s + jLat,
                600 + s * 400 + Math.random() * 300
              ),
              image: smokeImage,
              width: 30 + s * 15,
              height: 30 + s * 15,
              color: Color.WHITE.withAlpha(0.5 - s * 0.15),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            });
          }
        }
      } else {
        // Previously burned — dark red dots
        for (const h of hotspots) {
          burnedPoints.add({
            position: h.position,
            pixelSize: 5,
            color: Color.fromCssColorString("#CC2200").withAlpha(0.9),
            outlineColor: Color.BLACK.withAlpha(0.7),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });
        }
      }
    }

    return () => {
      if (burnedRef.current && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(burnedRef.current);
        burnedRef.current = null;
      }
      if (flameRef.current && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(flameRef.current);
        flameRef.current = null;
      }
      if (smokeRef.current && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(smokeRef.current);
        smokeRef.current = null;
      }
    };
  }, [viewer, currentFrame, framePositions, smokeImage, flameImage, flameImageSmall]);

  return null;
}
