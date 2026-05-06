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
      // Floor at 0.1 (was 0.3) so older trails fade further out of the way.
      const opacity = Math.max(0.1, 1 - elapsed / decaySteps);

      // The dropEvent's axis runs 5 km past each end of the burning bbox to
      // model the tanker's approach + exit. Retardant only gets dropped over
      // the actual fire — clip the trail to the inner 30% of the flight
      // axis so we paint just the drop zone, not the whole flight path.
      const t0 = 0.35;
      const t1 = 0.65;
      const trailStartLng = event.axisStart.lng + (event.axisEnd.lng - event.axisStart.lng) * t0;
      const trailStartLat = event.axisStart.lat + (event.axisEnd.lat - event.axisStart.lat) * t0;
      const trailEndLng = event.axisStart.lng + (event.axisEnd.lng - event.axisStart.lng) * t1;
      const trailEndLat = event.axisStart.lat + (event.axisEnd.lat - event.axisStart.lat) * t1;

      const entity = viewer.entities.add({
        polyline: {
          positions: Cartesian3.fromDegreesArray([
            trailStartLng,
            trailStartLat,
            trailEndLng,
            trailEndLat,
          ]),
          width: 4,
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
