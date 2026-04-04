import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  Color,
  PointPrimitiveCollection,
  NearFarScalar,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import type { HistoricalFire } from "../data/historicalFires";

interface HistoricalFireOverlayProps {
  fire: HistoricalFire;
  currentFrame: number;
  viewer: CesiumViewer | null;
}

export default function HistoricalFireOverlay({
  fire,
  currentFrame,
  viewer,
}: HistoricalFireOverlayProps) {
  const collectionRef = useRef<PointPrimitiveCollection | null>(null);

  // Pre-compute Cartesian3 positions for all hotspots (elevated above terrain)
  const framePositions = useMemo(() => {
    return fire.frames.map((frame) =>
      frame.hotspots.map((h) => ({
        position: Cartesian3.fromDegrees(h.lng, h.lat, 500),
        frp: h.frp,
      }))
    );
  }, [fire]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // Remove previous collection
    if (collectionRef.current) {
      viewer.scene.primitives.remove(collectionRef.current);
      collectionRef.current = null;
    }

    if (framePositions.length === 0) return;

    const points = new PointPrimitiveCollection();
    viewer.scene.primitives.add(points);
    collectionRef.current = points;

    // Scale point size based on camera distance
    const scaleByDistance = new NearFarScalar(5000, 10, 200000, 3);
    const scaleByDistancePrev = new NearFarScalar(5000, 6, 200000, 2);

    // Render all hotspots up to currentFrame
    for (let f = 0; f <= currentFrame && f < framePositions.length; f++) {
      const isCurrent = f === currentFrame;
      const hotspots = framePositions[f];

      for (const h of hotspots) {
        points.add({
          position: h.position,
          pixelSize: isCurrent ? 10 : 6,
          color: isCurrent
            ? Color.ORANGE
            : Color.fromCssColorString("#8B0000").withAlpha(0.8),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: isCurrent ? scaleByDistance : scaleByDistancePrev,
        });
      }
    }

    return () => {
      if (collectionRef.current && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(collectionRef.current);
        collectionRef.current = null;
      }
    };
  }, [viewer, currentFrame, framePositions]);

  return null;
}
