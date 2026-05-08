import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Cartesian3, Math as CesiumMath, Rectangle } from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import GlobeView from "./GlobeView";
import HistoricalFireOverlay from "./HistoricalFireOverlay";
import FireEffects from "./FireEffects";
import WaterOverlay from "./WaterOverlay";
import ContainmentLineLayer from "./ContainmentLineLayer";
import PolygonOverlay from "./PolygonOverlay";
import TimelineBar from "./TimelineBar";
import type {
  SimulationConfig,
  SimulationState,
  FuelType,
} from "../simulation/types";
import { CellState } from "../simulation/types";
import { convertSimulationToFire } from "../simulation/convertToFrames";
import type { LatLng } from "../utils/containmentCheck";

const MONO_FONT = { fontFamily: "'JetBrains Mono', monospace" } as const;

interface SplitCompareViewProps {
  isOpen: boolean;
  onClose: () => void;

  baselineHistory: SimulationState[];
  suppressedHistory: SimulationState[];
  config: SimulationConfig;
  ignitionPoint: { lat: number; lng: number };
  fuelMap: FuelType[] | null;
  boundaryPolygon: LatLng[] | null;
  currentStep: number;
  onStepChange: (step: number) => void;
  timestepMinutes: number;
  originDate?: Date | null;
}

export default function SplitCompareView(
  props: SplitCompareViewProps,
): ReactElement | null {
  const {
    isOpen,
    onClose,
    baselineHistory,
    suppressedHistory,
    config,
    ignitionPoint,
    fuelMap,
    boundaryPolygon,
    currentStep,
    onStepChange,
    timestepMinutes,
    originDate,
  } = props;

  const [leftViewer, setLeftViewer] = useState<CesiumViewer | null>(null);
  const [rightViewer, setRightViewer] = useState<CesiumViewer | null>(null);
  const isSyncingRef = useRef(false);

  // Build the activeFire frames for each side once per history change. Each
  // side uses the SAME ignition point + config, just a different sequence
  // of grid snapshots.
  const baselineFire = useMemo(
    () =>
      baselineHistory.length > 0
        ? convertSimulationToFire(
            baselineHistory,
            config,
            ignitionPoint.lat,
            ignitionPoint.lng,
            originDate ?? undefined,
          )
        : null,
    [baselineHistory, config, ignitionPoint.lat, ignitionPoint.lng, originDate],
  );

  const suppressedFire = useMemo(
    () =>
      suppressedHistory.length > 0
        ? convertSimulationToFire(
            suppressedHistory,
            config,
            ignitionPoint.lat,
            ignitionPoint.lng,
            originDate ?? undefined,
          )
        : null,
    [
      suppressedHistory,
      config,
      ignitionPoint.lat,
      ignitionPoint.lng,
      originDate,
    ],
  );

  // Per-side current snapshot for ContainmentLineLayer + metrics.
  const suppressedCurrentSnapshot = useMemo(() => {
    if (suppressedHistory.length === 0) return null;
    return suppressedHistory[Math.min(currentStep, suppressedHistory.length - 1)]
      .grid;
  }, [suppressedHistory, currentStep]);

  // Camera sync: one viewer's camera change propagates to the other.
  // The `isSyncingRef` guard prevents the propagated update from firing
  // a re-propagation (infinite ping-pong).
  useEffect(() => {
    if (!leftViewer || !rightViewer) return;

    const sync = (from: CesiumViewer, to: CesiumViewer) => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      to.camera.setView({
        destination: from.camera.position.clone(),
        orientation: {
          heading: from.camera.heading,
          pitch: from.camera.pitch,
          roll: from.camera.roll,
        },
      });
      // Defer the unset so any cascading move events from setView don't
      // trigger the OTHER side to bounce back.
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 0);
    };

    const onLeftMove = () => sync(leftViewer, rightViewer);
    const onRightMove = () => sync(rightViewer, leftViewer);

    leftViewer.camera.moveEnd.addEventListener(onLeftMove);
    rightViewer.camera.moveEnd.addEventListener(onRightMove);

    // Initial alignment so both start at the same view.
    sync(leftViewer, rightViewer);

    return () => {
      if (!leftViewer.isDestroyed()) {
        leftViewer.camera.moveEnd.removeEventListener(onLeftMove);
      }
      if (!rightViewer.isDestroyed()) {
        rightViewer.camera.moveEnd.removeEventListener(onRightMove);
      }
    };
  }, [leftViewer, rightViewer]);

  // Auto-frame the fire on open. Use the LARGER of the two final footprints
  // (almost always baseline) so both panes show the same area at the same
  // scale — that's what makes the difference visible at a glance. A
  // light tilt (~-50°) gives a 3D feel without sacrificing top-down area
  // perception. Runs once per (open + viewers ready); the camera-sync
  // ping-pong is suppressed during the flight via isSyncingRef.
  const haveAutoFramedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      haveAutoFramedRef.current = false;
      return;
    }
    if (haveAutoFramedRef.current) return;
    if (!leftViewer || !rightViewer) return;
    if (baselineHistory.length === 0 && suppressedHistory.length === 0) return;

    const rect = unionFireRect(
      [baselineHistory, suppressedHistory],
      config,
      ignitionPoint.lat,
      ignitionPoint.lng,
    );
    if (!rect) return;

    haveAutoFramedRef.current = true;
    isSyncingRef.current = true;

    const center = Rectangle.center(rect);
    const widthMeters =
      (rect.east - rect.west) *
      111_320 *
      Math.cos((center.latitude + center.latitude) / 2);
    const heightMeters = (rect.north - rect.south) * 111_320;
    const span = Math.max(widthMeters, heightMeters);
    // Camera height: enough to comfortably frame the rect at ~50° tilt.
    const camHeight = Math.max(span * 1.4, 4_000);

    // Pull the camera south of center so the tilt sweeps north toward
    // the fire — natural "looking-into-the-fire" feel. The southward
    // offset is derived from the camera pitch so the line of sight lands
    // exactly on the fire centroid (centered on screen). Pitch P below
    // horizontal → ground intersection is camHeight / tan(|P|) ahead.
    const pitch = -CesiumMath.PI_OVER_FOUR - CesiumMath.PI_OVER_TWO * 0.06;
    const tiltOffset = camHeight / Math.tan(-pitch);
    const offsetLat = -tiltOffset / 111_320;

    const destinationLat = CesiumMath.toDegrees(center.latitude) + offsetLat;
    const destinationLng = CesiumMath.toDegrees(center.longitude);
    const destination = Cartesian3.fromDegrees(
      destinationLng,
      destinationLat,
      camHeight,
    );
    const orientation = {
      heading: 0,
      pitch,
      roll: 0,
    };

    const release = () => {
      // Allow user-driven moveEnd events to resume syncing once both
      // animations have settled.
      isSyncingRef.current = false;
    };

    let pending = 2;
    const onComplete = () => {
      pending -= 1;
      if (pending <= 0) release();
    };

    leftViewer.camera.flyTo({
      destination,
      orientation,
      duration: 1.4,
      complete: onComplete,
      cancel: onComplete,
    });
    rightViewer.camera.flyTo({
      destination,
      orientation,
      duration: 1.4,
      complete: onComplete,
      cancel: onComplete,
    });

    // Safety: if flyTo never fires complete (e.g. user pans during it),
    // still re-enable sync after a hard timeout.
    const safety = window.setTimeout(release, 2_500);
    return () => window.clearTimeout(safety);
  }, [
    isOpen,
    leftViewer,
    rightViewer,
    baselineHistory,
    suppressedHistory,
    config,
    ignitionPoint.lat,
    ignitionPoint.lng,
  ]);

  // Per-side metrics for the header bars.
  const baselineMetrics = useMemo(
    () =>
      baselineHistory.length > 0
        ? gridMetrics(
            baselineHistory[Math.min(currentStep, baselineHistory.length - 1)],
            config,
          )
        : null,
    [baselineHistory, currentStep, config],
  );
  const suppressedMetrics = useMemo(
    () =>
      suppressedHistory.length > 0
        ? gridMetrics(
            suppressedHistory[
              Math.min(currentStep, suppressedHistory.length - 1)
            ],
            config,
          )
        : null,
    [suppressedHistory, currentStep, config],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex flex-col"
      style={{ background: "#0a0a0a" }}
    >
      {/* Top bar: title + close */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-black/50 backdrop-blur-md"
        style={MONO_FONT}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
          <h1 className="text-lg uppercase tracking-[0.18em] text-amber-400 font-bold">
            Side-by-Side Comparison
          </h1>
          <span className="text-caption text-gray-400 ml-3">
            Move the camera on either side — both stay in sync.
          </span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded text-caption uppercase tracking-[0.18em]
            text-amber-400 hover:bg-amber-500/15 hover:text-amber-300
            border border-white/[0.06] cursor-pointer transition-colors"
          style={MONO_FONT}
        >
          ← Back to single view
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* LEFT: Without control */}
        <Pane
          accent="red"
          title="Without Control"
          subtitle="No suppression deployed"
          metrics={baselineMetrics}
          totalSteps={baselineFire?.frames.length ?? 0}
        >
          <GlobeView onViewerReady={setLeftViewer} />
          {leftViewer && fuelMap && (
            <WaterOverlay
              fuelMap={fuelMap}
              centerLat={ignitionPoint.lat}
              centerLng={ignitionPoint.lng}
              config={config}
              viewer={leftViewer}
            />
          )}
          {leftViewer && baselineFire && (
            <>
              <HistoricalFireOverlay
                fire={baselineFire}
                currentFrame={Math.min(
                  currentStep,
                  baselineFire.frames.length - 1,
                )}
                viewer={leftViewer}
              />
              <FireEffects
                activePositions={
                  baselineFire.frames[
                    Math.min(currentStep, baselineFire.frames.length - 1)
                  ]?.hotspots.map((h) => ({ lat: h.lat, lng: h.lng })) ?? []
                }
                viewer={leftViewer}
              />
            </>
          )}
        </Pane>

        {/* Vertical divider */}
        <div className="w-[2px] bg-gradient-to-b from-amber-500/40 via-amber-500/10 to-amber-500/40" />

        {/* RIGHT: With control */}
        <Pane
          accent="amber"
          title="With Control"
          subtitle={
            boundaryPolygon
              ? "Suppression deployed against drawn boundary"
              : "Suppression deployed"
          }
          metrics={suppressedMetrics}
          totalSteps={suppressedFire?.frames.length ?? 0}
          baselineComparison={
            baselineMetrics && suppressedMetrics
              ? {
                  areaSavedHa:
                    baselineMetrics.burnedHa - suppressedMetrics.burnedHa,
                }
              : undefined
          }
        >
          <GlobeView onViewerReady={setRightViewer} />
          {rightViewer && fuelMap && (
            <WaterOverlay
              fuelMap={fuelMap}
              centerLat={ignitionPoint.lat}
              centerLng={ignitionPoint.lng}
              config={config}
              viewer={rightViewer}
            />
          )}
          {rightViewer && suppressedFire && (
            <>
              <HistoricalFireOverlay
                fire={suppressedFire}
                currentFrame={Math.min(
                  currentStep,
                  suppressedFire.frames.length - 1,
                )}
                viewer={rightViewer}
              />
              <FireEffects
                activePositions={
                  suppressedFire.frames[
                    Math.min(currentStep, suppressedFire.frames.length - 1)
                  ]?.hotspots.map((h) => ({ lat: h.lat, lng: h.lng })) ?? []
                }
                viewer={rightViewer}
              />
            </>
          )}
          {rightViewer && suppressedCurrentSnapshot && (
            <ContainmentLineLayer
              gridSnapshot={suppressedCurrentSnapshot}
              centerLat={ignitionPoint.lat}
              centerLng={ignitionPoint.lng}
              config={config}
              viewer={rightViewer}
            />
          )}
          {rightViewer && boundaryPolygon && (
            <PolygonOverlay
              viewer={rightViewer}
              polygon={boundaryPolygon}
              contained={false}
            />
          )}
        </Pane>
      </div>

      {/* Shared timeline drives both panes. Total steps = the longer of
          the two histories so playback covers the full duration; the
          shorter side will clamp to its last frame internally. */}
      {(() => {
        const total = Math.max(
          baselineHistory.length,
          suppressedHistory.length,
        );
        if (total === 0) return null;
        return (
          <div className="border-t border-white/[0.06] bg-black/60 backdrop-blur-md">
            <TimelineBar
              totalSteps={total - 1}
              currentStep={Math.min(currentStep, total - 1)}
              onStepChange={onStepChange}
              timestepMinutes={timestepMinutes}
            />
          </div>
        );
      })()}
    </div>
  );
}

interface PaneProps {
  accent: "red" | "amber";
  title: string;
  subtitle: string;
  metrics: GridMetrics | null;
  totalSteps: number;
  baselineComparison?: { areaSavedHa: number };
  children: React.ReactNode;
}

function Pane({
  accent,
  title,
  subtitle,
  metrics,
  totalSteps,
  baselineComparison,
  children,
}: PaneProps): ReactElement {
  const accentColor = accent === "red" ? "#dc2626" : "var(--fire-amber)";
  const accentBg =
    accent === "red" ? "rgba(220, 38, 38, 0.12)" : "rgba(245, 158, 11, 0.10)";
  const accentBorder =
    accent === "red"
      ? "rgba(220, 38, 38, 0.30)"
      : "rgba(245, 158, 11, 0.30)";

  return (
    <div className="flex-1 relative min-w-0">
      <header
        className="absolute top-3 left-3 right-3 z-30 flex items-start justify-between gap-3 rounded-xl px-4 py-3 backdrop-blur-md"
        style={{
          background: accentBg,
          border: `1px solid ${accentBorder}`,
          ...MONO_FONT,
        }}
      >
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: accentColor,
                boxShadow: `0 0 6px ${accentColor}`,
              }}
            />
            <h2
              className="text-base uppercase tracking-[0.18em] font-bold"
              style={{ color: accentColor }}
            >
              {title}
            </h2>
          </div>
          <div className="text-caption text-gray-400">{subtitle}</div>
        </div>
        <div className="text-right">
          {metrics && (
            <>
              <div
                className="text-base font-bold tabular-nums"
                style={{ color: accentColor }}
              >
                {formatHa(metrics.burnedHa)}
              </div>
              <div className="text-micro text-gray-500 uppercase tracking-wider">
                Area burned
              </div>
              {baselineComparison && (
                <div className="text-micro text-emerald-400 mt-1 tabular-nums">
                  +{formatHa(baselineComparison.areaSavedHa)} saved
                </div>
              )}
            </>
          )}
          <div className="text-micro text-gray-500 mt-1 tabular-nums">
            Step {Math.min((metrics ? totalSteps : 0), totalSteps)} of{" "}
            {totalSteps || 0}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

interface GridMetrics {
  burningCells: number;
  burnedCells: number;
  suppressedCells: number;
  burnedHa: number;
}

function gridMetrics(state: SimulationState, config: SimulationConfig): GridMetrics {
  const { grid } = state;
  let burning = 0;
  let burned = 0;
  let suppressed = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === CellState.Burning) burning++;
    else if (grid[i] === CellState.Burned) burned++;
    else if (grid[i] === CellState.Suppressed) suppressed++;
  }
  const haPerCell = (config.cellSizeMeters * config.cellSizeMeters) / 10_000;
  return {
    burningCells: burning,
    burnedCells: burned,
    suppressedCells: suppressed,
    burnedHa: (burning + burned) * haPerCell,
  };
}

function formatHa(ha: number): string {
  if (ha >= 1000) return `${(ha / 1000).toFixed(1)}k ha`;
  return `${Math.round(ha)} ha`;
}

/**
 * Compute a Cesium Rectangle that covers the union of all
 * burned/burning/suppressed cells across the LAST frame of every history
 * passed in. Used to auto-frame both panes on the worst-case fire
 * footprint so the "without vs with control" difference is visible.
 *
 * Returns null if no fire activity is present in any history.
 */
function unionFireRect(
  histories: SimulationState[][],
  config: SimulationConfig,
  centerLat: number,
  centerLng: number,
): Rectangle | null {
  const { gridSize, cellSizeMeters } = config;
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  let found = false;

  for (const history of histories) {
    if (history.length === 0) continue;
    const grid = history[history.length - 1].grid;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== CellState.Unburned) {
        const row = Math.floor(i / gridSize);
        const col = i - row * gridSize;
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
        found = true;
      }
    }
  }
  if (!found) return null;

  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);
  const cellLat = cellSizeMeters / metersPerDegLat;
  const cellLng = cellSizeMeters / metersPerDegLng;
  const half = gridSize / 2;

  let south = centerLat + (minRow - half) * cellLat;
  let north = centerLat + (maxRow + 1 - half) * cellLat;
  let west = centerLng + (minCol - half) * cellLng;
  let east = centerLng + (maxCol + 1 - half) * cellLng;

  // Pad ~30% so the fire perimeter has breathing room.
  const padLat = (north - south) * 0.3;
  const padLng = (east - west) * 0.3;
  south -= padLat;
  north += padLat;
  west -= padLng;
  east += padLng;

  // Floor: ensure we frame at least ~3 km × 3 km so newly-ignited
  // (1-cell) fires still have surrounding terrain context.
  const MIN_SPAN_M = 3_000;
  const latSpan = (north - south) * metersPerDegLat;
  const lngSpan = (east - west) * metersPerDegLng;
  if (latSpan < MIN_SPAN_M) {
    const cLat = (north + south) / 2;
    const halfLat = MIN_SPAN_M / 2 / metersPerDegLat;
    south = cLat - halfLat;
    north = cLat + halfLat;
  }
  if (lngSpan < MIN_SPAN_M) {
    const cLng = (east + west) / 2;
    const halfLng = MIN_SPAN_M / 2 / metersPerDegLng;
    west = cLng - halfLng;
    east = cLng + halfLng;
  }

  return Rectangle.fromDegrees(west, south, east, north);
}
