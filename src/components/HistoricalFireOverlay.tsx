import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  Color,
  PointPrimitiveCollection,
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

  // Pre-compute Cartesian3 positions for all hotspots
  const framePositions = useMemo(() => {
    return fire.frames.map((frame) =>
      frame.hotspots.map((h) => ({
        position: Cartesian3.fromDegrees(h.lng, h.lat, 0),
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

    const points = viewer.scene.primitives.add(new PointPrimitiveCollection());
    collectionRef.current = points;

    // Render all hotspots up to currentFrame
    for (let f = 0; f <= currentFrame && f < framePositions.length; f++) {
      const isCurrent = f === currentFrame;
      const hotspots = framePositions[f];

      for (const h of hotspots) {
        const color = isCurrent
          ? Color.ORANGE
          : Color.fromCssColorString("#1a0000").withAlpha(0.8);

        points.add({
          position: h.position,
          pixelSize: isCurrent ? 5 : 3,
          color,
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
