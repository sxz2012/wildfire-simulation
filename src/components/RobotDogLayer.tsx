import { useEffect, useRef } from "react";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  HeadingPitchRange,
  HeadingPitchRoll,
  HeightReference,
  LabelStyle,
  Matrix4,
  Transforms,
  CallbackProperty,
  CallbackPositionProperty,
  PolylineArrowMaterialProperty,
  VerticalOrigin,
} from "cesium";
import type { Viewer as CesiumViewer, Entity } from "cesium";
import { missionPose } from "../simulation/robot/mission";
import type { Mission } from "../simulation/robot/mission";
import { cellCenter, gridToLatLng } from "../simulation/robot/geo";
import { arrowChunks } from "../simulation/robot/worlds";
import type { Plan } from "../simulation/robot/types";

interface RobotDogLayerProps {
  viewer: CesiumViewer | null;
  mission: Mission | null;
  /** Simulation minute of the current timeline step. */
  nowMin: number;
  playing: boolean;
  timestepMinutes: number;
  gridSize: number;
  cellSizeMeters: number;
  centerLat: number;
  centerLng: number;
  follow?: boolean;
  /** Staging cell chosen while the target is still being placed. */
  pendingStagingIdx?: number | null;
}

const ROUTE_COLOR = Color.fromCssColorString("#2D6CDF");
const ESCAPE_COLOR = Color.fromCssColorString("#2E8540");
const MODEL_URL = "/models/robot-dog.glb";
// Cesium loads glTF with +Z forward, so the model (three.js +X forward) faces north at heading 0.
const MODEL_YAW_OFFSET_DEG = 0;
const MIN_PIXEL_SIZE = 64;
const ARROW_WIDTH = 18;
const FOLLOW_RANGE_M = 4000;

export default function RobotDogLayer({
  viewer,
  mission,
  nowMin,
  playing,
  timestepMinutes,
  gridSize,
  cellSizeMeters,
  centerLat,
  centerLng,
  follow = false,
  pendingStagingIdx = null,
}: RobotDogLayerProps): null {
  const dogRef = useRef<Entity | null>(null);
  const routeRef = useRef<Entity | null>(null);
  const escapeRef = useRef<Entity | null>(null);
  const homeRef = useRef<Entity | null>(null);
  const flagRef = useRef<Entity | null>(null);
  const arrowRefs = useRef<Entity[]>([]);
  const arrowPlanRef = useRef<Plan | null>(null);

  // Everything the per-frame callbacks read lives in refs.
  const missionRef = useRef(mission);
  const geoRef = useRef({ gridSize, cellSizeMeters, centerLat, centerLng });
  const clockRef = useRef({ nowMin, changedAt: performance.now(), intervalMs: 500, playing });
  const followRef = useRef(follow);

  useEffect(() => {
    missionRef.current = mission;
    geoRef.current = { gridSize, cellSizeMeters, centerLat, centerLng };
    followRef.current = follow;
  }, [mission, gridSize, cellSizeMeters, centerLat, centerLng, follow]);

  // Measure the playback interval between step changes for smooth interpolation.
  useEffect(() => {
    const c = clockRef.current;
    const t = performance.now();
    if (nowMin > c.nowMin && nowMin - c.nowMin <= timestepMinutes * 1.01) {
      c.intervalMs = Math.max(30, t - c.changedAt);
    }
    c.nowMin = nowMin;
    c.changedAt = t;
    c.playing = playing;
  }, [nowMin, playing, timestepMinutes]);

  const displayMin = () => {
    const c = clockRef.current;
    if (!c.playing) return c.nowMin;
    const frac = Math.min(1, (performance.now() - c.changedAt) / c.intervalMs);
    return c.nowMin + frac * timestepMinutes;
  };

  const dogCartesian = (): Cartesian3 | null => {
    const m = missionRef.current;
    if (!m) return null;
    const g = geoRef.current;
    const p = missionPose(m, displayMin(), g.gridSize);
    const ll = gridToLatLng(p.row, p.col, g.gridSize, g.cellSizeMeters, g.centerLat, g.centerLng);
    return Cartesian3.fromDegrees(ll.lng, ll.lat);
  };

  // Dog model + staging/target markers: created once per viewer.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const scratch = new Cartesian3();
    dogRef.current = viewer.entities.add({
      position: new CallbackPositionProperty(
        () => dogCartesian() ?? Cartesian3.clone(Cartesian3.ZERO, scratch),
        false,
      ),
      orientation: new CallbackProperty(() => {
        const m = missionRef.current;
        const pos = dogCartesian();
        if (!m || !pos) return undefined;
        const heading = missionPose(m, displayMin(), geoRef.current.gridSize).headingDeg;
        const hpr = new HeadingPitchRoll(((heading + MODEL_YAW_OFFSET_DEG) * Math.PI) / 180, 0, 0);
        return Transforms.headingPitchRollQuaternion(pos, hpr);
      }, false),
      model: {
        uri: MODEL_URL,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        minimumPixelSize: MIN_PIXEL_SIZE,
      },
    });

    const marker = (text: string, color: Color): Entity =>
      viewer.entities.add({
        position: Cartesian3.fromDegrees(0, 0),
        point: {
          pixelSize: 14,
          color,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text,
          font: "600 15px sans-serif",
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -14),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        show: false,
      });
    homeRef.current = marker("🏠 Staging", ESCAPE_COLOR);
    flagRef.current = marker("🚩 Scout target", ROUTE_COLOR);

    return () => {
      if (viewer.isDestroyed()) return;
      for (const r of [dogRef, routeRef, escapeRef, homeRef, flagRef]) {
        if (r.current) viewer.entities.remove(r.current);
        r.current = null;
      }
      for (const e of arrowRefs.current) viewer.entities.remove(e);
      arrowRefs.current = [];
      arrowPlanRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  // Markers and paths follow mission changes (re-plans happen on step changes, not per frame).
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const at = (idx: number) => {
      const ll = cellCenter(idx, gridSize, cellSizeMeters, centerLat, centerLng);
      return Cartesian3.fromDegrees(ll.lng, ll.lat);
    };
    if (dogRef.current) dogRef.current.show = !!mission;
    for (const [ref, idx] of [
      [homeRef, mission?.stagingIdx ?? pendingStagingIdx],
      [flagRef, mission?.targetIdx],
    ] as const) {
      if (!ref.current) continue;
      ref.current.show = idx != null;
      if (idx != null) ref.current.position = at(idx) as never;
    }

    const syncLine = (ref: { current: Entity | null }, plan: Plan | null | undefined, color: Color, zIndex: number) => {
      const positions = plan && plan.cells.length > 1 ? plan.cells.map(at) : null;
      if (!positions) {
        if (ref.current) viewer.entities.remove(ref.current);
        ref.current = null;
        return;
      }
      if (ref.current?.polyline) {
        ref.current.polyline.positions = positions as never;
        return;
      }
      ref.current = viewer.entities.add({
        polyline: { positions, width: 5, material: color, clampToGround: true, zIndex },
      });
    };
    // The escape path draws above the route so it stays visible where they overlap.
    syncLine(routeRef, mission?.route, ROUTE_COLOR, 1);
    syncLine(escapeRef, mission?.escape, ESCAPE_COLOR, 2);

    // Arrowheads along the escape path, pointing home; rebuilt only when the escape plan changes.
    const escape = mission?.escape ?? null;
    if (escape !== arrowPlanRef.current) {
      for (const e of arrowRefs.current) viewer.entities.remove(e);
      arrowRefs.current = [];
      arrowPlanRef.current = escape;
      if (escape && escape.cells.length > 1) {
        for (const [from, to] of arrowChunks(escape.cells)) {
          arrowRefs.current.push(viewer.entities.add({
            polyline: {
              positions: escape.cells.slice(from, to + 1).map(at),
              width: ARROW_WIDTH,
              material: new PolylineArrowMaterialProperty(ESCAPE_COLOR),
              clampToGround: true,
              zIndex: 3,
            },
          }));
        }
      }
    }
  }, [viewer, mission, pendingStagingIdx, gridSize, cellSizeMeters, centerLat, centerLng]);

  // Optional camera follow: keep the dog centred, keep the user's heading/pitch/zoom.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !follow) return;
    const camera = viewer.camera;
    let range = FOLLOW_RANGE_M;
    const onPreRender = () => {
      const pos = dogCartesian();
      if (!pos) return;
      const carto = Cartographic.fromCartesian(pos);
      carto.height = viewer.scene.globe.getHeight(carto) ?? 0;
      const target = Cartographic.toCartesian(carto);
      if (!camera.transform.equals(Matrix4.IDENTITY)) range = Cartesian3.magnitude(camera.position);
      camera.lookAt(target, new HeadingPitchRange(camera.heading, camera.pitch, range));
    };
    const remove = viewer.scene.preRender.addEventListener(onPreRender);
    return () => {
      remove();
      if (!viewer.isDestroyed()) camera.lookAtTransform(Matrix4.IDENTITY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, follow]);

  return null;
}
