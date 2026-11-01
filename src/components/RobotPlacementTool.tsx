import { useEffect, useRef } from "react";
import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";

interface RobotPlacementToolProps {
  viewer: CesiumViewer | null;
  active: boolean;
  onPick: (lat: number, lng: number) => void;
}

/** One-click globe picker for the robot staging point and scout target. */
export default function RobotPlacementTool({ viewer, active, onPick }: RobotPlacementToolProps): null {
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active) return;
    const canvas = viewer.scene.canvas;
    canvas.style.cursor = "crosshair";
    const handler = new ScreenSpaceEventHandler(canvas);
    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      let cartesian: Cartesian3 | undefined = viewer.scene.pickPosition(event.position);
      if (!cartesian) {
        cartesian = viewer.camera.pickEllipsoid(event.position, viewer.scene.globe.ellipsoid) ?? undefined;
      }
      if (!cartesian) return;
      const carto = Cartographic.fromCartesian(cartesian);
      onPickRef.current(CesiumMath.toDegrees(carto.latitude), CesiumMath.toDegrees(carto.longitude));
    }, ScreenSpaceEventType.LEFT_CLICK);
    return () => {
      handler.destroy();
      canvas.style.cursor = "";
    };
  }, [viewer, active]);

  return null;
}
