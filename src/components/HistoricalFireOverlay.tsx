import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  Color,
  PointPrimitiveCollection,
  BillboardCollection,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import type { HistoricalFire } from "../data/historicalFires";

interface HistoricalFireOverlayProps {
  fire: HistoricalFire;
  currentFrame: number;
  viewer: CesiumViewer | null;
}

// Generate a smoke texture on canvas
function createSmokeImage(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(180, 180, 180, 0.35)");
  gradient.addColorStop(0.4, "rgba(140, 140, 140, 0.2)");
  gradient.addColorStop(1, "rgba(100, 100, 100, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

// Generate a fire glow texture
function createFireGlowImage(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "rgba(255, 200, 50, 0.8)");
  gradient.addColorStop(0.3, "rgba(255, 100, 0, 0.5)");
  gradient.addColorStop(0.7, "rgba(200, 50, 0, 0.2)");
  gradient.addColorStop(1, "rgba(150, 30, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  return canvas;
}

export default function HistoricalFireOverlay({
  fire,
  currentFrame,
  viewer,
}: HistoricalFireOverlayProps) {
  const pointsRef = useRef<PointPrimitiveCollection | null>(null);
  const smokeRef = useRef<BillboardCollection | null>(null);
  const glowRef = useRef<BillboardCollection | null>(null);

  const smokeImage = useMemo(() => createSmokeImage(), []);
  const fireGlowImage = useMemo(() => createFireGlowImage(), []);

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

    // Cleanup previous
    if (pointsRef.current) viewer.scene.primitives.remove(pointsRef.current);
    if (smokeRef.current) viewer.scene.primitives.remove(smokeRef.current);
    if (glowRef.current) viewer.scene.primitives.remove(glowRef.current);
    pointsRef.current = null;
    smokeRef.current = null;
    glowRef.current = null;

    if (framePositions.length === 0) return;

    const points = new PointPrimitiveCollection();
    const smokeBillboards = new BillboardCollection();
    const glowBillboards = new BillboardCollection();
    viewer.scene.primitives.add(points);
    viewer.scene.primitives.add(glowBillboards);
    viewer.scene.primitives.add(smokeBillboards);
    pointsRef.current = points;
    smokeRef.current = smokeBillboards;
    glowRef.current = glowBillboards;

    // Prevailing wind direction (simplified — drift smoke to the east/northeast)
    const windAngle = (Math.PI / 4) * 0.7; // ~30 degrees
    const driftLat = Math.cos(windAngle) * 0.008;
    const driftLng = Math.sin(windAngle) * 0.008;

    // Render all frames up to currentFrame
    for (let f = 0; f <= currentFrame && f < framePositions.length; f++) {
      const isCurrent = f === currentFrame;
      const hotspots = framePositions[f];

      for (const h of hotspots) {
        points.add({
          position: h.position,
          pixelSize: isCurrent ? 6 : 5,
          color: isCurrent
            ? Color.fromCssColorString("#FF4500")
            : Color.fromCssColorString("#CC2200").withAlpha(0.9),
          outlineColor: isCurrent
            ? Color.fromCssColorString("#FF0000")
            : Color.BLACK.withAlpha(0.7),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }

      // Add fire glow and smoke only for current frame (active fire)
      if (isCurrent) {
        // Sample hotspots for effects (max 80 for performance)
        const step = hotspots.length > 80 ? Math.ceil(hotspots.length / 80) : 1;

        for (let i = 0; i < hotspots.length; i += step) {
          const h = hotspots[i];

          // Fire glow billboard at fire location
          glowBillboards.add({
            position: Cartesian3.fromDegrees(h.lng, h.lat, 400),
            image: fireGlowImage,
            width: 25,
            height: 25,
            color: Color.WHITE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });

          // Smoke billboards — drifting away from fire in wind direction
          // Multiple smoke puffs at varying heights and offsets
          for (let s = 1; s <= 3; s++) {
            const jitterLat = (Math.random() - 0.5) * 0.003;
            const jitterLng = (Math.random() - 0.5) * 0.003;
            const smokeLat = h.lat + driftLat * s + jitterLat;
            const smokeLng = h.lng + driftLng * s + jitterLng;
            const smokeAlt = 600 + s * 400 + Math.random() * 300;

            smokeBillboards.add({
              position: Cartesian3.fromDegrees(smokeLng, smokeLat, smokeAlt),
              image: smokeImage,
              width: 30 + s * 15,
              height: 30 + s * 15,
              color: Color.WHITE.withAlpha(0.6 - s * 0.12),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            });
          }
        }
      }
    }

    return () => {
      if (pointsRef.current && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(pointsRef.current);
        pointsRef.current = null;
      }
      if (smokeRef.current && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(smokeRef.current);
        smokeRef.current = null;
      }
      if (glowRef.current && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(glowRef.current);
        glowRef.current = null;
      }
    };
  }, [viewer, currentFrame, framePositions, smokeImage, fireGlowImage]);

  return null;
}
