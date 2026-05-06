import { useEffect, useRef } from "react";
import {
  Cartesian3,
  Color,
  CallbackProperty,
  ColorMaterialProperty,
  PolygonHierarchy,
} from "cesium";
import type { Viewer as CesiumViewer, Entity } from "cesium";
import type { LatLng } from "../utils/containmentCheck";

interface PolygonOverlayProps {
  viewer: CesiumViewer | null;
  polygon: LatLng[] | null;
  contained: boolean;
}

export default function PolygonOverlay({
  viewer,
  polygon,
  contained,
}: PolygonOverlayProps): null {
  const polylineRef = useRef<Entity | null>(null);
  const polygonRef = useRef<Entity | null>(null);
  const flashUntilMsRef = useRef<number | null>(null);
  const lastContainedRef = useRef<boolean>(contained);

  useEffect(() => {
    if (contained && !lastContainedRef.current) {
      flashUntilMsRef.current = performance.now() + 1000;
    }
    lastContainedRef.current = contained;
  }, [contained]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !polygon || polygon.length < 3) return;

    const positionsCb = new CallbackProperty(() => {
      return [...polygon, polygon[0]].map((p) => Cartesian3.fromDegrees(p.lng, p.lat));
    }, false);

    const hierarchyCb = new CallbackProperty(() => {
      return new PolygonHierarchy(polygon.map((p) => Cartesian3.fromDegrees(p.lng, p.lat)));
    }, false);

    // Outline color: cyan when active fire, green during the 1-second
    // success flash. Alpha drops from 0.5 → 0.2 once contained.
    const outlineMaterial = new ColorMaterialProperty(
      new CallbackProperty(() => {
        const flashing =
          flashUntilMsRef.current !== null && performance.now() < flashUntilMsRef.current;
        const baseAlpha = contained ? 0.2 : 0.5;
        if (flashing) return Color.fromCssColorString("#22c55e").withAlpha(0.9);
        return Color.fromCssColorString("#22d3ee").withAlpha(baseAlpha);
      }, false),
    );

    const fillMaterial = new ColorMaterialProperty(
      new CallbackProperty(() => {
        const flashing =
          flashUntilMsRef.current !== null && performance.now() < flashUntilMsRef.current;
        const baseAlpha = contained ? 0.06 : 0.1;
        if (flashing) return Color.fromCssColorString("#22c55e").withAlpha(0.18);
        return Color.fromCssColorString("#22d3ee").withAlpha(baseAlpha);
      }, false),
    );

    const polyline = viewer.entities.add({
      polyline: {
        positions: positionsCb,
        material: outlineMaterial,
        width: 2,
        clampToGround: true,
      },
    });
    polylineRef.current = polyline;

    const polygonEntity = viewer.entities.add({
      polygon: {
        hierarchy: hierarchyCb,
        material: fillMaterial,
      },
    });
    polygonRef.current = polygonEntity;

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.entities.remove(polyline);
        viewer.entities.remove(polygonEntity);
      }
      polylineRef.current = null;
      polygonRef.current = null;
    };
  }, [viewer, polygon, contained]);

  return null;
}
