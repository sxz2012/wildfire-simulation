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

  const framePositions = useMemo(() => {
    return fire.frames.map((frame) =>
      frame.hotspots.map((h) => Cartesian3.fromDegrees(h.lng, h.lat, 300))
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

    // Render all hotspots up to currentFrame
    for (let f = 0; f <= currentFrame && f < framePositions.length; f++) {
      const isCurrent = f === currentFrame;
      const hotspots = framePositions[f];

      for (const position of hotspots) {
        points.add({
          position,
          pixelSize: isCurrent ? 4 : 3,
          color: isCurrent
            ? Color.fromCssColorString("#FF4500")
            : Color.fromCssColorString("#1a0000").withAlpha(0.7),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
