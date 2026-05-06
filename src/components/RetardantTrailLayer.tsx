import { useEffect, useRef } from "react";
import { Color, Cartesian3 } from "cesium";
import type { Viewer as CesiumViewer, Entity } from "cesium";
import type { DropEvent } from "../utils/dropScheduler";

interface RetardantTrailLayerProps {
  viewer: CesiumViewer | null;
  dropEvents: DropEvent[];
  currentStep: number;
  timestepMinutes: number;
}

export default function RetardantTrailLayer({
  viewer,
  dropEvents,
  currentStep,
  timestepMinutes,
}: RetardantTrailLayerProps) {
  const entitiesRef = useRef<Entity[]>([]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // 10 sim-minute decay window mapped to step count via timestepMinutes
    const decaySteps = Math.max(1, Math.round(10 / timestepMinutes));

    for (const event of dropEvents) {
      if (event.centerStep > currentStep) continue;
      const elapsed = currentStep - event.centerStep;
      const opacity = Math.max(0.3, 1 - elapsed / decaySteps);

      const entity = viewer.entities.add({
        polyline: {
          positions: Cartesian3.fromDegreesArray([
            event.axisStart.lng,
            event.axisStart.lat,
            event.axisEnd.lng,
            event.axisEnd.lat,
          ]),
          width: 8,
          material: Color.fromCssColorString("#d92121").withAlpha(opacity),
          clampToGround: true,
        },
      });

      entitiesRef.current.push(entity);
    }

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        for (const entity of entitiesRef.current) {
          viewer.entities.remove(entity);
        }
      }
      entitiesRef.current = [];
    };
  }, [viewer, dropEvents, currentStep, timestepMinutes]);

  return null;
}
