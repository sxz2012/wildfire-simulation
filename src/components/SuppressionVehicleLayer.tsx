import { useEffect, useRef } from "react";
import {
  Cartesian3,
  Color,
  HeightReference,
  HeadingPitchRoll,
  Transforms,
  CallbackProperty,
  CallbackPositionProperty,
  ConstantPositionProperty,
  ConstantProperty,
} from "cesium";
import type { Viewer as CesiumViewer, Entity } from "cesium";
import { CellState } from "../simulation/types";
import type { SimulationState, SimulationConfig, SuppressionConfig } from "../simulation/types";
import { groundPositions, type LatLng } from "../utils/groundPositions";
import { perTypeCounts } from "../utils/perTypeCounts";
import type { DropEvent } from "../utils/dropScheduler";

interface SuppressionVehicleLayerProps {
  viewer: CesiumViewer | null;
  prev: SimulationState | null;
  curr: SimulationState;
  config: SimulationConfig;
  centerLat: number;
  centerLng: number;
  suppression: SuppressionConfig;
  deployStep: number;
  endStep: number;
  currentStep: number;
  dropEvents: DropEvent[];
}

type GroundType = "engine" | "crew" | "dozer";
type VehicleType = GroundType | "helitack" | "tanker";

const MODEL_URLS: Record<VehicleType, string> = {
  engine: "/models/firetruck.glb",
  crew: "/models/pickup.glb",
  dozer: "/models/bulldozer.glb",
  helitack: "/models/helicopter.glb",
  tanker: "/models/airtanker.glb",
};

// Per-type uniform scale. Most poly.pizza models export at ~1m bounding box.
const MODEL_SCALES: Record<VehicleType, number> = {
  engine: 1.0,
  crew: 1.0,
  dozer: 1.0,
  helitack: 1.0,
  tanker: 1.0,
};

// minimumPixelSize keeps models legible from far camera positions.
const MIN_PIXEL_SIZE_GROUND = 32;
const MIN_PIXEL_SIZE_AIR = 48;

// Cap rendered glTF entity count per type so a max-capacity roster
// (e.g. 13 dozers from the boundary inverse search) doesn't spike GPU
// memory past the tab's budget. The HUD still shows the true counts.
const MAX_VISIBLE_PER_TYPE = 5;

const HELI_ORBIT_RADIUS_M = 400;
const HELI_ORBIT_ALT_M = 60;
const HELI_ORBIT_PERIOD_SEC = 30;
const TANKER_ALT_M = 150;

function bearingRad(from: LatLng, to: LatLng): number {
  const dLng = to.lng - from.lng;
  const dLat = to.lat - from.lat;
  return Math.atan2(dLng * Math.cos((from.lat * Math.PI) / 180), dLat);
}

function activeFireCentroid(
  state: SimulationState,
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
): LatLng | null {
  const { gridSize, cellSizeMeters } = config;
  const grid = state.grid;
  const len = grid.length;
  let sumRow = 0;
  let sumCol = 0;
  let count = 0;
  for (let i = 0; i < len; i++) {
    if (grid[i] === CellState.Burning) {
      const row = Math.floor(i / gridSize);
      const col = i - row * gridSize;
      sumRow += row;
      sumCol += col;
      count++;
    }
  }
  if (count === 0) return null;
  const avgRow = sumRow / count;
  const avgCol = sumCol / count;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const cellLat = cellSizeMeters / metersPerDegLat;
  const cellLng = cellSizeMeters / metersPerDegLng;
  const half = gridSize / 2;
  return {
    lat: centerLat + (avgRow - half) * cellLat,
    lng: centerLng + (avgCol - half) * cellLng,
  };
}

export default function SuppressionVehicleLayer({
  viewer,
  prev,
  curr,
  config,
  centerLat,
  centerLng,
  suppression,
  deployStep,
  endStep,
  currentStep,
  dropEvents,
}: SuppressionVehicleLayerProps): null {
  const engineEntitiesRef = useRef<Entity[]>([]);
  const crewEntitiesRef = useRef<Entity[]>([]);
  const dozerEntitiesRef = useRef<Entity[]>([]);
  const helitackEntitiesRef = useRef<Entity[]>([]);
  const tankerEntitiesRef = useRef<Map<number, Entity>>(new Map());

  const lastFramePos = useRef<{ engines: LatLng[]; crews: LatLng[]; dozers: LatLng[] }>({
    engines: [],
    crews: [],
    dozers: [],
  });

  const firstSeenMs = useRef<{
    engines: number | null;
    crews: number | null;
    dozers: number | null;
    helitack: number | null;
  }>({ engines: null, crews: null, dozers: null, helitack: null });

  const currCachedRef = useRef<SimulationState>(curr);
  const configCachedRef = useRef<SimulationConfig>(config);
  const centerLatCachedRef = useRef<number>(centerLat);
  const centerLngCachedRef = useRef<number>(centerLng);
  const dropEventsCachedRef = useRef<DropEvent[]>(dropEvents);
  const currentStepCachedRef = useRef<number>(currentStep);

  useEffect(() => {
    currCachedRef.current = curr;
    configCachedRef.current = config;
    centerLatCachedRef.current = centerLat;
    centerLngCachedRef.current = centerLng;
    dropEventsCachedRef.current = dropEvents;
    currentStepCachedRef.current = currentStep;
  }, [curr, config, centerLat, centerLng, dropEvents, currentStep]);

  // Cleanup on viewer change / unmount
  useEffect(() => {
    return () => {
      if (!viewer || viewer.isDestroyed()) return;
      const all: Entity[] = [
        ...engineEntitiesRef.current,
        ...crewEntitiesRef.current,
        ...dozerEntitiesRef.current,
        ...helitackEntitiesRef.current,
      ];
      for (const e of all) viewer.entities.remove(e);
      tankerEntitiesRef.current.forEach((e) => viewer.entities.remove(e));
      engineEntitiesRef.current = [];
      crewEntitiesRef.current = [];
      dozerEntitiesRef.current = [];
      helitackEntitiesRef.current = [];
      tankerEntitiesRef.current = new Map();
    };
  }, [viewer]);

  // Ground vehicles: engines, crews, dozers
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const counts = perTypeCounts({
      bundle: suppression.resources,
      step: currentStep,
      deployStep,
      endStep,
    });

    const cap = (n: number) => Math.min(n, MAX_VISIBLE_PER_TYPE);
    const enginePositions = groundPositions(
      prev, curr, config, centerLat, centerLng, cap(counts.engines), lastFramePos.current.engines,
    );
    const crewPositions = groundPositions(
      prev, curr, config, centerLat, centerLng, cap(counts.crews), lastFramePos.current.crews,
    );
    const dozerPositions = groundPositions(
      prev, curr, config, centerLat, centerLng, cap(counts.dozers), lastFramePos.current.dozers,
    );
    lastFramePos.current.engines = enginePositions;
    lastFramePos.current.crews = crewPositions;
    lastFramePos.current.dozers = dozerPositions;

    const arrivalDurationMs = 30 * (config.timestepMinutes / 60) * 1000;
    const computeAlpha = (key: "engines" | "crews" | "dozers", count: number): number => {
      if (count === 0) {
        firstSeenMs.current[key] = null;
        return 1;
      }
      if (firstSeenMs.current[key] === null) firstSeenMs.current[key] = performance.now();
      const start = firstSeenMs.current[key]!;
      const t = (performance.now() - start) / arrivalDurationMs;
      return Math.max(0, Math.min(1, t));
    };
    const engineAlpha = computeAlpha("engines", counts.engines);
    const crewAlpha = computeAlpha("crews", counts.crews);
    const dozerAlpha = computeAlpha("dozers", counts.dozers);

    const fireCentroid = activeFireCentroid(curr, config, centerLat, centerLng);

    const sync = (
      ref: { current: Entity[] },
      positions: LatLng[],
      type: GroundType,
      alpha: number,
    ) => {
      const list = ref.current;
      while (list.length > positions.length) {
        const e = list.pop()!;
        viewer.entities.remove(e);
      }
      while (list.length < positions.length) {
        const e = viewer.entities.add({
          position: Cartesian3.fromDegrees(0, 0),
          model: {
            uri: MODEL_URLS[type],
            scale: MODEL_SCALES[type],
            heightReference: HeightReference.CLAMP_TO_GROUND,
            minimumPixelSize: MIN_PIXEL_SIZE_GROUND,
          },
        });
        list.push(e);
      }
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        const ent = list[i];
        const pos = Cartesian3.fromDegrees(p.lng, p.lat);
        ent.position = new ConstantPositionProperty(pos);
        const heading = fireCentroid ? bearingRad(p, fireCentroid) : 0;
        const hpr = new HeadingPitchRoll(heading, 0, 0);
        ent.orientation = new ConstantProperty(
          Transforms.headingPitchRollQuaternion(pos, hpr),
        );
        if (ent.model) {
          ent.model.color = new ConstantProperty(Color.WHITE.withAlpha(alpha));
        }
      }
    };

    sync(engineEntitiesRef, enginePositions, "engine", engineAlpha);
    sync(crewEntitiesRef, crewPositions, "crew", crewAlpha);
    sync(dozerEntitiesRef, dozerPositions, "dozer", dozerAlpha);
  }, [
    viewer, prev, curr, config, centerLat, centerLng,
    suppression, deployStep, endStep, currentStep,
  ]);

  // Helitack: orbit around fire centroid via CallbackProperty
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const counts = perTypeCounts({
      bundle: suppression.resources,
      step: currentStep,
      deployStep,
      endStep,
    });

    if (counts.helitack === 0) firstSeenMs.current.helitack = null;
    else if (firstSeenMs.current.helitack === null) {
      firstSeenMs.current.helitack = performance.now();
    }

    const list = helitackEntitiesRef.current;
    const visibleHelitack = Math.min(counts.helitack, MAX_VISIBLE_PER_TYPE);

    while (list.length > visibleHelitack) {
      const e = list.pop()!;
      viewer.entities.remove(e);
    }
    while (list.length < visibleHelitack) {
      const idxAtCreation = list.length;
      const startMs = performance.now();

      const computePose = (): { lng: number; lat: number; headingRad: number } | null => {
        const centroid = activeFireCentroid(
          currCachedRef.current,
          configCachedRef.current,
          centerLatCachedRef.current,
          centerLngCachedRef.current,
        );
        if (!centroid) return null;
        const elapsedSec = (performance.now() - startMs) / 1000;
        const omega = (2 * Math.PI) / HELI_ORBIT_PERIOD_SEC;
        const N = Math.max(1, list.length);
        const baseAngle = (idxAtCreation / N) * 2 * Math.PI;
        const angle = baseAngle + omega * elapsedSec;
        const metersPerDegLat = 111_320;
        const metersPerDegLng = 111_320 * Math.cos((centroid.lat * Math.PI) / 180);
        const dxM = HELI_ORBIT_RADIUS_M * Math.cos(angle);
        const dyM = HELI_ORBIT_RADIUS_M * Math.sin(angle);
        return {
          lat: centroid.lat + dyM / metersPerDegLat,
          lng: centroid.lng + dxM / metersPerDegLng,
          headingRad: angle + Math.PI / 2, // tangent to circular orbit
        };
      };

      const e = viewer.entities.add({
        position: new CallbackPositionProperty(() => {
          const p = computePose();
          const lng = p ? p.lng : centerLngCachedRef.current;
          const lat = p ? p.lat : centerLatCachedRef.current;
          return Cartesian3.fromDegrees(lng, lat, HELI_ORBIT_ALT_M);
        }, false),
        orientation: new CallbackProperty(() => {
          const p = computePose();
          const lng = p ? p.lng : centerLngCachedRef.current;
          const lat = p ? p.lat : centerLatCachedRef.current;
          const heading = p ? p.headingRad : 0;
          return Transforms.headingPitchRollQuaternion(
            Cartesian3.fromDegrees(lng, lat, HELI_ORBIT_ALT_M),
            new HeadingPitchRoll(heading, 0, 0),
          );
        }, false),
        model: {
          uri: MODEL_URLS.helitack,
          scale: MODEL_SCALES.helitack,
          minimumPixelSize: MIN_PIXEL_SIZE_AIR,
          color: new CallbackProperty(() => {
            const arrivalMs = 3 * (configCachedRef.current.timestepMinutes / 60) * 1000;
            const seen = firstSeenMs.current.helitack;
            const a = seen === null
              ? 1
              : Math.max(0, Math.min(1, (performance.now() - seen) / arrivalMs));
            return Color.WHITE.withAlpha(a);
          }, false),
        },
      });
      list.push(e);
    }
  }, [viewer, suppression, deployStep, endStep, currentStep]);

  // Tankers: per-drop-event entities animated along their drop axis
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const callback = () => {
      const dropEvts = dropEventsCachedRef.current;
      const cs = currentStepCachedRef.current;
      const map = tankerEntitiesRef.current;

      const activeDrops = dropEvts.filter((e) => cs >= e.startStep && cs <= e.endStep);
      const activeIdxs = new Set(activeDrops.map((e) => e.tankerIdx));

      for (const [idx, ent] of map) {
        if (!activeIdxs.has(idx)) {
          viewer.entities.remove(ent);
          map.delete(idx);
        }
      }

      for (const drop of activeDrops) {
        if (map.has(drop.tankerIdx)) continue;
        const ent = viewer.entities.add({
          position: new CallbackPositionProperty(() => {
            const span = drop.endStep - drop.startStep;
            const cur = currentStepCachedRef.current;
            const t = span > 0 ? (cur - drop.startStep) / span : 0;
            const lat = drop.axisStart.lat + (drop.axisEnd.lat - drop.axisStart.lat) * t;
            const lng = drop.axisStart.lng + (drop.axisEnd.lng - drop.axisStart.lng) * t;
            return Cartesian3.fromDegrees(lng, lat, TANKER_ALT_M);
          }, false),
          orientation: new CallbackProperty(() => {
            const span = drop.endStep - drop.startStep;
            const cur = currentStepCachedRef.current;
            const t = span > 0 ? (cur - drop.startStep) / span : 0;
            const lat = drop.axisStart.lat + (drop.axisEnd.lat - drop.axisStart.lat) * t;
            const lng = drop.axisStart.lng + (drop.axisEnd.lng - drop.axisStart.lng) * t;
            const heading = bearingRad(drop.axisStart, drop.axisEnd);
            return Transforms.headingPitchRollQuaternion(
              Cartesian3.fromDegrees(lng, lat, TANKER_ALT_M),
              new HeadingPitchRoll(heading, 0, 0),
            );
          }, false),
          model: {
            uri: MODEL_URLS.tanker,
            scale: MODEL_SCALES.tanker,
            minimumPixelSize: MIN_PIXEL_SIZE_AIR,
          },
        });
        map.set(drop.tankerIdx, ent);
      }
    };

    viewer.scene.preRender.addEventListener(callback);
    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.preRender.removeEventListener(callback);
      }
    };
  }, [viewer]);

  return null;
}
