import { useEffect, useRef, useState } from "react";
import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  Color,
  CallbackProperty,
  PointPrimitiveCollection,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  PolygonHierarchy,
} from "cesium";
import type { Viewer as CesiumViewer, Entity, Cartesian2 } from "cesium";
import type { LatLng } from "../utils/containmentCheck";

interface BoundaryDrawToolProps {
  viewer: CesiumViewer | null;
  active: boolean;
  onClose: (polygon: LatLng[]) => void;
  onCancel: () => void;
  onValidationError?: (msg: string) => void;
  onVerticesChange?: (vertices: LatLng[]) => void;
  /**
   * Parent increments this to request that the tool validate and finalize
   * the current polygon (same flow as double-click-to-close). 0 / undefined
   * is ignored.
   */
  closeRequest?: number;
}

const FIRST_VERTEX_SNAP_PX = 30;
const VERTEX_HIT_RADIUS_PX = 18;
const MIN_POLYGON_AREA_M2 = 10_000;

function distance2D(a: Cartesian2, b: Cartesian2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function shoelaceArea(polygon: LatLng[], centerLat: number): number {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng * metersPerDegLng;
    const yi = polygon[i].lat * metersPerDegLat;
    const xj = polygon[j].lng * metersPerDegLng;
    const yj = polygon[j].lat * metersPerDegLat;
    sum += xi * yj - xj * yi;
  }
  return Math.abs(sum) / 2;
}

function direction(a: LatLng, b: LatLng, c: LatLng): number {
  return (c.lng - a.lng) * (b.lat - a.lat) - (b.lng - a.lng) * (c.lat - a.lat);
}

function segmentsIntersect(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

function hasSelfIntersection(polygon: LatLng[]): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

export default function BoundaryDrawTool({
  viewer,
  active,
  onClose,
  onCancel,
  onValidationError,
  onVerticesChange,
  closeRequest,
}: BoundaryDrawToolProps): null {
  const [vertices, setVertices] = useState<LatLng[]>([]);
  const verticesRef = useRef(vertices);
  verticesRef.current = vertices;
  const pointCollectionRef = useRef<PointPrimitiveCollection | null>(null);
  const polylineEntityRef = useRef<Entity | null>(null);
  const polygonEntityRef = useRef<Entity | null>(null);

  // Stable refs for callbacks so the close handler can call them without
  // re-binding the input handlers every time the parent re-renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onValidationErrorRef = useRef(onValidationError);
  onValidationErrorRef.current = onValidationError;

  useEffect(() => {
    if (active) setVertices([]);
  }, [active]);

  // Notify parent whenever vertex set changes.
  useEffect(() => {
    onVerticesChange?.(vertices);
  }, [vertices, onVerticesChange]);

  // Shared close-validation flow used by both double-click and the parent's
  // explicit Compute button (closeRequest).
  const tryClose = (poly: LatLng[]) => {
    if (poly.length < 3) return;
    if (hasSelfIntersection(poly)) {
      onValidationErrorRef.current?.("Polygon crosses itself — adjust vertices");
      return;
    }
    const meanLat = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
    const area = shoelaceArea(poly, meanLat);
    if (area < MIN_POLYGON_AREA_M2) {
      onValidationErrorRef.current?.("Boundary too small — try again");
      return;
    }
    onCloseRef.current(poly);
  };

  // Parent-driven close request (Compute button).
  useEffect(() => {
    if (!active) return;
    if (closeRequest === undefined || closeRequest === 0) return;
    tryClose(verticesRef.current);
    // tryClose is stable enough — it only reads refs. Intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeRequest, active]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active) return;

    // Crosshair cursor while drawing.
    const canvas = viewer.scene.canvas;
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = "crosshair";

    const handler = new ScreenSpaceEventHandler(canvas);

    const pickLatLng = (screenPos: Cartesian2): LatLng | null => {
      let cartesian: Cartesian3 | undefined = viewer.scene.pickPosition(screenPos);
      if (!cartesian) {
        const ellipsoid = viewer.scene.globe.ellipsoid;
        cartesian = viewer.camera.pickEllipsoid(screenPos, ellipsoid) ?? undefined;
      }
      if (!cartesian) return null;
      const carto = Cartographic.fromCartesian(cartesian);
      return {
        lat: CesiumMath.toDegrees(carto.latitude),
        lng: CesiumMath.toDegrees(carto.longitude),
      };
    };

    let draggingIndex: number | null = null;
    let wasDragged = false;

    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      wasDragged = false;
      const screenPos = event.position;
      const v = verticesRef.current;
      // Hit-test: find the closest vertex within VERTEX_HIT_RADIUS_PX.
      let bestIdx = -1;
      let bestDist = VERTEX_HIT_RADIUS_PX;
      for (let i = 0; i < v.length; i++) {
        const world = Cartesian3.fromDegrees(v[i].lng, v[i].lat);
        const screen = viewer.scene.cartesianToCanvasCoordinates(world);
        if (!screen) continue;
        const d = distance2D(screen, screenPos);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        draggingIndex = bestIdx;
        // Disable camera input so panning doesn't fight the drag.
        viewer.scene.screenSpaceCameraController.enableInputs = false;
      }
    }, ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((movement: ScreenSpaceEventHandler.MotionEvent) => {
      if (draggingIndex === null) return;
      const newPt = pickLatLng(movement.endPosition);
      if (!newPt) return;
      wasDragged = true;
      const v = verticesRef.current;
      const next = [...v];
      next[draggingIndex] = newPt;
      setVertices(next);
    }, ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      if (draggingIndex !== null) {
        draggingIndex = null;
        viewer.scene.screenSpaceCameraController.enableInputs = true;
      }
    }, ScreenSpaceEventType.LEFT_UP);

    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      // If the click was actually a drag-edit, swallow it so we don't append
      // a duplicate vertex.
      if (wasDragged) {
        wasDragged = false;
        return;
      }
      const screenPos = event.position;
      const newPt = pickLatLng(screenPos);
      if (!newPt) return;

      const current = verticesRef.current;
      if (current.length >= 3) {
        const firstWorld = Cartesian3.fromDegrees(current[0].lng, current[0].lat);
        const firstScreen = viewer.scene.cartesianToCanvasCoordinates(firstWorld);
        if (firstScreen && distance2D(firstScreen, screenPos) < FIRST_VERTEX_SNAP_PX) {
          tryClose(current);
          return;
        }
      }
      setVertices([...current, newPt]);
    }, ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => {
      tryClose(verticesRef.current);
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    handler.setInputAction(() => {
      const current = verticesRef.current;
      if (current.length === 0) return;
      setVertices(current.slice(0, -1));
    }, ScreenSpaceEventType.RIGHT_CLICK);

    return () => {
      handler.destroy();
      // Always restore camera (defensive against drag-mid-unmount) and cursor.
      if (!viewer.isDestroyed()) {
        viewer.scene.screenSpaceCameraController.enableInputs = true;
        canvas.style.cursor = previousCursor;
      }
    };
  }, [viewer, active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onCancel]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    let collection = pointCollectionRef.current;
    if (!collection) {
      collection = new PointPrimitiveCollection();
      viewer.scene.primitives.add(collection);
      pointCollectionRef.current = collection;
    }
    collection.removeAll();
    if (active) {
      vertices.forEach((v, i) => {
        const isLatest = i === vertices.length - 1;
        collection.add({
          position: Cartesian3.fromDegrees(v.lng, v.lat),
          color: Color.fromCssColorString(isLatest ? "#fde047" : "#facc15"),
          pixelSize: isLatest ? 18 : 14,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          // Always render above 3D Tiles / terrain — without this the discs
          // get depth-tested away when the camera angle puts terrain in front.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      });
    }
  }, [viewer, active, vertices]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active) return;

    const polyline = viewer.entities.add({
      polyline: {
        positions: new CallbackProperty(() => {
          const v = verticesRef.current;
          if (v.length < 2) return [];
          const closed = v.length >= 3 ? [...v, v[0]] : v;
          return closed.map((p) => Cartesian3.fromDegrees(p.lng, p.lat));
        }, false),
        material: Color.fromCssColorString("#facc15").withAlpha(0.8),
        width: 3,
        clampToGround: true,
      },
    });
    polylineEntityRef.current = polyline;

    const polygon = viewer.entities.add({
      polygon: {
        hierarchy: new CallbackProperty(() => {
          const v = verticesRef.current;
          if (v.length < 3) return new PolygonHierarchy([]);
          return new PolygonHierarchy(
            v.map((p) => Cartesian3.fromDegrees(p.lng, p.lat)),
          );
        }, false),
        material: Color.fromCssColorString("#facc15").withAlpha(0.15),
      },
    });
    polygonEntityRef.current = polygon;

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.entities.remove(polyline);
        viewer.entities.remove(polygon);
      }
      polylineEntityRef.current = null;
      polygonEntityRef.current = null;
    };
  }, [viewer, active]);

  useEffect(() => {
    return () => {
      if (pointCollectionRef.current && viewer && !viewer.isDestroyed()) {
        viewer.scene.primitives.remove(pointCollectionRef.current);
      }
      pointCollectionRef.current = null;
    };
  }, [viewer]);

  return null;
}
