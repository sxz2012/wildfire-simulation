import { useEffect, useRef } from "react";
import { Color, Material, PolylineCollection, Cartesian3 } from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
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
  const collectionRef = useRef<PolylineCollection | null>(null);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const collection = new PolylineCollection();
    viewer.scene.primitives.add(collection);
    collectionRef.current = collection;

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(collection);
      }
      collectionRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const collection = collectionRef.current;
    if (!viewer || viewer.isDestroyed() || !collection) return;

    collection.removeAll();

    // 10 sim-minute decay window mapped to step count via timestepMinutes
    const decaySteps = Math.max(1, Math.round(10 / timestepMinutes));

    for (const event of dropEvents) {
      if (event.centerStep > currentStep) continue;
      const elapsed = currentStep - event.centerStep;
      const opacity = Math.max(0.3, 1 - elapsed / decaySteps);

      collection.add({
        positions: Cartesian3.fromDegreesArray([
          event.axisStart.lng,
          event.axisStart.lat,
          event.axisEnd.lng,
          event.axisEnd.lat,
        ]),
        width: 8,
        material: Material.fromType("Color", {
          color: Color.fromCssColorString("#d92121").withAlpha(opacity),
        }),
        clampToGround: true,
      });
    }
  }, [viewer, dropEvents, currentStep, timestepMinutes]);

  return null;
}
