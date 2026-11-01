import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import GlobeView from "./components/GlobeView";
import ControlPanel from "./components/ControlPanel";
import TimelineBar from "./components/TimelineBar";
import HistoricalFireOverlay from "./components/HistoricalFireOverlay";
import FireEffects from "./components/FireEffects";
import WaterOverlay from "./components/WaterOverlay";
import ContainmentLineLayer from "./components/ContainmentLineLayer";
import GhostFireOverlay from "./components/GhostFireOverlay";
import SuppressionHUD from "./components/SuppressionHUD";
import IgnitionPin from "./components/IgnitionPin";
import Legend from "./components/Legend";
import ResourcesReference from "./components/ResourcesReference";
import SplitCompareView from "./components/SplitCompareView";
import BoundaryDrawTool from "./components/BoundaryDrawTool";
import RecommendationCard from "./components/RecommendationCard";
import PolygonOverlay from "./components/PolygonOverlay";
import { useModelConfig } from "./contexts/ModelConfig";
import { reverseGeocode } from "./components/LocationSearch";
import { apiExtend, apiQBoundary, type ApiQBoundaryResponse } from "./services/simulationApi";
import type { LatLng } from "./utils/containmentCheck";
import { rleDecode } from "./utils/rle";
// ImpactPanel is now integrated into ControlPanel as ImpactSection
import TimeInfoPanel from "./components/TimeInfoPanel";
import { useSimulation } from "./simulation/useSimulation";
import { DEFAULT_CONFIG, FuelType, ResourceType, type SimulationConfig, type ResourceCount } from "./simulation/types";
import ResourceAvailability from "./components/ResourceAvailability";
import { dropScheduler, type DropEvent } from "./utils/dropScheduler";
import { convertSimulationToFire } from "./simulation/convertToFrames";
import { loadHistoricalFire, type HistoricalFire } from "./data/historicalFires";
import { fetchCurrentWeather, getSeasonalWeather, type Season, type WeatherData } from "./services/weather";
import { sampleVegetation } from "./services/vegetation";
import { sampleElevations } from "./services/terrain";
import { sampleLandCover } from "./services/landCover";
import { loadScenario, type LoadedScenario } from "./services/scenarioLoader";
import { fetchNearbyFireStations, type NearbyFireResources } from "./services/fireResources";
import type { ScenarioSummary } from "./components/ScenarioPicker";
import type { Viewer as CesiumViewer } from "cesium";
import { InfoModalProvider } from "./info/InfoContext";
import InfoModal from "./info/InfoModal";
import BriefingConsole from "./components/BriefingConsole";
import RobotDogLayer from "./components/RobotDogLayer";
import RobotDogHUD from "./components/RobotDogHUD";
import RobotPlacementTool from "./components/RobotPlacementTool";
import { ROBOT_DEFAULTS, type PlannerGrid, type RobotConfig } from "./simulation/robot/types";
import { computeIgnitionMinutes, passableFromFuel } from "./simulation/robot/hazard";
import { latLngToCell, snapToSafeCell } from "./simulation/robot/geo";
import { burningCentroid, shiftedWind, tailReplaceCommits } from "./simulation/robot/windShift";
import {
  createMission,
  missionFitsForecast,
  missionMarginMin,
  missionPose,
  syncMission,
  type Mission,
  type MissionEntry,
  type MissionPhase,
} from "./simulation/robot/mission";

interface RobotState {
  placing: "staging" | "target" | null;
  stagingIdx: number | null;
  targetIdx: number | null;
  /** Current mission state (the log's last entry). */
  mission: Mission | null;
  /** Time-stamped mission states, so scrubbing the timeline moves the dog too. */
  log: MissionEntry[];
  windShifted: boolean;
  shiftPending: boolean;
  notice: string | null;
  /** Last mission event, kept on screen until the next one. */
  lastEvent: string | null;
}

const WIND_SHIFT_WINDOW_STEPS = 96;

const ROBOT_PROMPT = {
  staging: "Click a staging point (safe start)",
  target: "Click the scout target near the fire edge",
} as const;

interface RobotDemoInfo {
  center: { lat: number; lng: number };
  gridSize: number;
  cellSizeMeters: number;
  windDirection: number;
  step: number;
  centroid: { row: number; col: number } | null;
  burningCells: number;
  baselineLength: number;
  /** Cells from the centroid to the fire's downwind edge. */
  headEdgeCells: number;
}

declare global {
  interface Window {
    __robotDemo?: {
      start(staging: { lat: number; lng: number }, target: { lat: number; lng: number }): string | null;
      shiftWind(): Promise<void>;
      state(): { phase: MissionPhase | null; replanCount: number; event: string | null };
      info(): RobotDemoInfo | null;
    };
  }
}

type AppMode =
  | "idle"
  | "simulation"
  | "historical"
  | "paused-drawing"
  | "paused-computing"
  | "paused-recommendation"
  | "simulation-resumed";

function App() {
  const { history, isRunning, startSimulation, reset, setHistory } = useSimulation();
  const { config: modelConfig } = useModelConfig();
  const [currentStep, setCurrentStep] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>("idle");
  const [ignitionPoint, setIgnitionPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; altitude: number; _t: number } | null>(null);
  const [activeConfig, setActiveConfig] = useState<SimulationConfig>(DEFAULT_CONFIG);
  const [activeFuelMap, setActiveFuelMap] = useState<FuelType[] | null>(null);
  // Terrain for the robot planner's slope cost and the wind-shift re-forecast.
  const [elevationMap, setElevationMap] = useState<Float32Array | null>(null);
  const [robot, setRobot] = useState<RobotState | null>(null);
  const [robotFollow, setRobotFollow] = useState(false);
  const [activeOriginDate, setActiveOriginDate] = useState<Date | null>(null);
  // Where the user has placed the ignition flame pin but not yet confirmed.
  // Globe clicks update this; the actual simulation only starts when the
  // user clicks the "Start the Wildfire" button in ControlPanel.
  const [pendingIgnition, setPendingIgnition] = useState<{ lat: number; lng: number } | null>(null);
  const [activeScenario, setActiveScenario] = useState<LoadedScenario | null>(null);
  const [suppressionDelay, setSuppressionDelay] = useState(30);
  // Default to wildfire-only ([]). Suppression is applied through the
  // Suggest Containment flow, not the panel — so live ignites start
  // unsuppressed and the user opts in via pause → draw → compute → approve.
  const [suppressionResources, setSuppressionResources] = useState<ResourceCount[]>([]);
  const [nearbyResources, setNearbyResources] = useState<NearbyFireResources | null>(null);
  // True between "Start the Wildfire" being clicked and the worker actually
  // running. Bridges the async gap (weather + land cover + terrain fetches)
  // so the button reads "Simulating..." continuously instead of flashing
  // back to "Click Globe to Ignite" during loading.
  const [isPreparingSim, setIsPreparingSim] = useState(false);
  const [locationDisplay, setLocationDisplay] = useState<string | undefined>(undefined);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const [simKey, setSimKey] = useState(0);
  const [activeFire, setActiveFire] = useState<HistoricalFire | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [weatherInfo, setWeatherInfo] = useState<string>("");
  const weatherSourceRef = useRef<{ source: "live" | "seasonal" | "custom"; season?: Season }>({ source: "live" });

  // Pause-draw-compute-resume flow state.
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [pausedGrid, setPausedGrid] = useState<Uint8Array | null>(null);
  const [pausedStep, setPausedStep] = useState<number>(0);
  const [boundaryPolygon, setBoundaryPolygon] = useState<LatLng[] | null>(null);
  const [boundaryResult, setBoundaryResult] = useState<ApiQBoundaryResponse | null>(null);
  const [, setShowBreachPreview] = useState(false);
  // Live vertex count from BoundaryDrawTool, used to enable the Compute button.
  const [drawingVertices, setDrawingVertices] = useState<LatLng[]>([]);
  // Incremented to ask BoundaryDrawTool to validate + finalize the polygon.
  const [computeRequestKey, setComputeRequestKey] = useState(0);
  const [resourcesReferenceOpen, setResourcesReferenceOpen] = useState(false);
  const [splitCompareOpen, setSplitCompareOpen] = useState(false);
  // Which resource types the inverse-search solver may use when computing
  // a recommended roster. Defaults to every solver-supported type; the user
  // narrows this down before each Compute via ResourceAvailability.
  const [availableTypes, setAvailableTypes] = useState<ResourceType[]>([
    ResourceType.Type1Dozer,
    ResourceType.Type1Crew,
    ResourceType.Type2Crew,
    ResourceType.Engine,
    ResourceType.Helitack,
    ResourceType.AirTanker,
  ]);

  const handleViewerReady = useCallback((viewer: CesiumViewer) => {
    viewerRef.current = viewer;
  }, []);

  const handleSuppressionChange = useCallback(
    (delay: number, resources: ResourceCount[]) => {
      setSuppressionDelay(delay);
      setSuppressionResources(resources);
    },
    [],
  );

  // Clears per-run scene state (history, ignition, mode, autoplay) without
  // touching the user's input choices (suppression toggle, delay, bundle,
  // scenario pick). Called automatically before starting a new run so the
  // map is fresh, but the panel keeps what the user just set.
  const runReset = useCallback(() => {
    reset();
    setCurrentStep(0);
    setIgnitionPoint(null);
    setActiveFire(null);
    setActiveFuelMap(null);
    setElevationMap(null);
    setRobot(null);
    setRobotFollow(false);
    setActiveOriginDate(null);
    setPendingIgnition(null);
    setAppMode("idle");
    setAutoPlay(false);
    setSimKey((k) => k + 1);
    // Clear any in-flight boundary-search state so the cyan polygon
    // outline (PolygonOverlay), the Model Details button, and the
    // recommendation card all unmount cleanly on Reset / new ignition.
    setPausedGrid(null);
    setPausedStep(0);
    setBoundaryPolygon(null);
    setBoundaryResult(null);
    setDrawingVertices([]);
    setComputeRequestKey(0);
  }, [reset]);

  // Full reset: per-run state plus user inputs returned to defaults. Wired
  // to the explicit Reset button only.
  const fullReset = useCallback(() => {
    runReset();
    setSuppressionDelay(30);
    setSuppressionResources([]);
    setActiveScenario(null);
    setNearbyResources(null);
    setLocationDisplay(undefined);
  }, [runReset]);

  // Convert simulation history to fire frames when the worker finishes a run.
  // Implemented as a real effect (rather than an inline render-time side effect)
  // so it always fires for each new run, regardless of how step counts compare
  // to the previous one. The earlier ref-based gate could silently no-op when
  // a second simulation produced the same number of steps as the first.
  useEffect(() => {
    if (appMode !== "simulation") return;
    // Prefer the suppressed run as the visible foreground when present;
    // baseline shows as the counterfactual ghost via GhostFireOverlay.
    const active =
      history.suppressed && history.suppressed.length > 0
        ? history.suppressed
        : history.baseline;
    if (active.length === 0) return;
    if (!ignitionPoint) return;
    const fire = convertSimulationToFire(
      active,
      activeConfig,
      ignitionPoint.lat,
      ignitionPoint.lng,
      activeOriginDate ?? undefined,
    );
    setActiveFire(fire);
    setAutoPlay(true);
  }, [history, appMode, ignitionPoint, activeConfig, activeOriginDate]);

  // Globe click in idle mode just drops/moves the flame pin. The user
  // confirms by clicking "Start the Wildfire" in ControlPanel.
  const handlePlacePin = useCallback(
    (lat: number, lng: number) => {
      // If a previous run's visualization is still on screen, clear it
      // before placing a fresh pin so the scene resets cleanly.
      if (appMode === "simulation") runReset();
      setPendingIgnition({ lat, lng });
      setFlyTo({ lat, lng, altitude: 15000, _t: Date.now() });
      // Best-effort: reverse-geocode the click so the Location input
      // shows where the user dropped the pin. Failures (rate limit,
      // offline) silently leave the field empty.
      reverseGeocode(lat, lng).then((label) => {
        if (label) setLocationDisplay(label);
      });
      // Best-effort: fetch nearby fire stations to suggest a bundle.
      fetchNearbyFireStations(lat, lng, 10)
        .then(setNearbyResources)
        .catch((err) => console.warn("Could not fetch nearby resources:", err));
    },
    [appMode, runReset],
  );

  const handleStartWildfire = useCallback(
    async (lat: number, lng: number) => {
      setIsPreparingSim(true);
      runReset();
      setAppMode("simulation");
      setIgnitionPoint({ lat, lng });
      setFlyTo({ lat, lng, altitude: 15000, _t: Date.now() });

      // Fetch weather based on selected source. For "live", also capture
      // the current wall-clock time as the simulation's origin so that
      // timeline labels show real dates/times instead of "Day 1, HH:MM".
      let weather: WeatherData;
      const ws = weatherSourceRef.current;
      try {
        if (ws.source === "live") {
          weather = await fetchCurrentWeather(lat, lng);
          setWeatherInfo(`Live: ${weather.windSpeed} km/h wind ${weather.windDirection}°, ${weather.humidity}% humidity, ${weather.temperature}°C`);
          setActiveOriginDate(new Date());
        } else {
          weather = getSeasonalWeather(lat, ws.season || "summer");
          setWeatherInfo(`${ws.season}: ${weather.windSpeed} km/h wind ${weather.windDirection}°, ${weather.humidity}% humidity`);
          setActiveOriginDate(null);
        }
      } catch {
        weather = { windSpeed: 20, windDirection: 270, humidity: 30, temperature: 25, source: "fallback" };
        setWeatherInfo("Weather unavailable — using defaults");
        setActiveOriginDate(null);
      }

      const config: SimulationConfig = {
        ...DEFAULT_CONFIG,
        windSpeed: weather.windSpeed,
        windDirection: weather.windDirection,
        humidity: weather.humidity,
      };
      setActiveConfig(config);

      // Build the fuel map and elevation map for the simulation grid.
      //
      // Preference order for land cover:
      //   1. ESA WorldCover 10m (Microsoft Planetary Computer) — authoritative
      //      land-cover classification: water, urban, forest, etc.
      //   2. Satellite imagery color sampling — fragile fallback when WorldCover
      //      is unreachable.
      //
      // Elevation sampling runs in parallel; the elevation map is needed by the
      // ML model and the Rothermel slope calculation regardless of which
      // land-cover source we use. We also keep an elevation-based water override
      // (elevation ≤ 0) as belt-and-braces for ocean/bay cells.
      const viewer = viewerRef.current;
      let fuelMap: FuelType[] | undefined;
      let elevationMap: Float32Array | undefined;

      const [worldCoverFuels, sampledElevations] = await Promise.all([
        sampleLandCover(lat, lng, config.gridSize, config.cellSizeMeters).catch(
          () => null,
        ),
        viewer && !viewer.isDestroyed()
          ? sampleElevations(
              viewer,
              lat,
              lng,
              config.gridSize,
              config.cellSizeMeters,
            ).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);

      elevationMap = sampledElevations;
      setElevationMap(sampledElevations ?? null);

      if (worldCoverFuels) {
        // WorldCover is pixel-perfect at 10m and explicitly classifies water
        // (class 80). Trust it — do NOT layer on the elevation-based water
        // override, which is sampled in 12x12 blocks and would replace
        // WorldCover's smooth coastline with rectangular non-flammable
        // patches whenever a coastal sample point happens to fall over
        // water.
        fuelMap = worldCoverFuels;
      } else {
        // Imagery / procedural fallback path. WorldCover unavailable, so use
        // imagery color sampling for fuels and the elevation override as the
        // best-effort water mask.
        if (viewer && !viewer.isDestroyed()) {
          try {
            fuelMap = sampleVegetation(
              viewer,
              lat,
              lng,
              config.gridSize,
              config.cellSizeMeters,
            );
          } catch {
            // Fall back to procedural assignment in createGrid.
          }
        }
        if (fuelMap && elevationMap) {
          for (let i = 0; i < fuelMap.length; i++) {
            if (elevationMap[i] <= 0) fuelMap[i] = FuelType.Water;
          }
        }
      }

      const center = Math.floor(config.gridSize / 2);

      // Safety net: if the click landed directly on a non-flammable cell
      // (e.g., user clicked the middle of a lake), force the ignition cell
      // to Grass so the user gets visual feedback. Fire still won't spread
      // if the surrounding cells are all water — that's realistic.
      if (fuelMap) {
        const igniteIdx = center * config.gridSize + center;
        if (fuelMap[igniteIdx] === FuelType.Water) {
          fuelMap[igniteIdx] = FuelType.Grass;
        }
      }

      // Lift fuelMap to state so WaterOverlay can render it.
      setActiveFuelMap(fuelMap ?? null);

      startSimulation(
        config, center, center, lat, lng, fuelMap,
        { tempMean: weather.temperature, tempMax: weather.temperature + 5, precipitation: 0, cumulativePrecip: 0 },
        undefined, elevationMap,
        { responseDelayMin: suppressionDelay, resources: suppressionResources },
      );
      setIsPreparingSim(false);
    },
    [runReset, startSimulation, suppressionDelay, suppressionResources]
  );

  const handleScenarioPick = useCallback(async (scenario: ScenarioSummary) => {
    runReset();
    try {
      const loaded = await loadScenario(scenario.jsonPath);
      setActiveScenario(loaded);
      setIgnitionPoint(loaded.meta.location);
      setLocationDisplay(loaded.meta.name);
      const cfg: SimulationConfig = { ...DEFAULT_CONFIG, ...loaded.meta.config };
      setActiveConfig(cfg);
      setFlyTo({
        lat: loaded.meta.location.lat,
        lng: loaded.meta.location.lng,
        altitude: 15000,
        _t: Date.now(),
      });
      setAppMode("simulation");
      // NOT injecting loaded.{baseline,suppressed,diags} into useSimulation:
      // it OOMs the tab. Once history.suppressed is populated, both
      // ContainmentLineLayer and GhostFireOverlay regenerate 600x600 canvases
      // and PNG-encode them at every currentStep tick — at autoplay's ~5 Hz
      // over 200 steps that's ~2000 toDataURL("image/png") calls per side,
      // plus the new glTF SuppressionVehicleLayer's per-frame CallbackProperty
      // grid scans. Live-ignite path doesn't hit this because its history is
      // produced incrementally by the worker. Precomputed scenarios still
      // play back via activeFire / convertSimulationToFire below.
      if (loaded.meta.suppression) {
        setSuppressionDelay(loaded.meta.suppression.responseDelayMin);
        setSuppressionResources(loaded.meta.suppression.resources);
      }
      // Use the suppressed history when available, otherwise baseline.
      const activeHistory =
        loaded.suppressed && loaded.suppressed.history.length > 0
          ? loaded.suppressed.history
          : loaded.baseline.history;
      const fire = convertSimulationToFire(
        activeHistory,
        cfg,
        loaded.meta.location.lat,
        loaded.meta.location.lng,
      );
      setActiveFire(fire);
      setAutoPlay(true);
    } catch (err) {
      console.error("Scenario load failed:", err);
    }
  }, [runReset]);

  const handleScenarioLive = useCallback(() => {
    runReset();
    setActiveScenario(null);
  }, [runReset]);

  const handleSuggestContainment = useCallback(() => {
    if (!history.suppressed && history.baseline.length > 0 && ignitionPoint) {
      // Wildfire-only run: snapshot from baseline at currentStep.
      const snapshot =
        history.baseline[Math.min(currentStep, history.baseline.length - 1)].grid;
      // Defensive copy so subsequent step changes don't mutate our paused grid.
      setPausedGrid(new Uint8Array(snapshot));
      setPausedStep(currentStep);
      setBoundaryPolygon(null);
      setBoundaryResult(null);
      setShowBreachPreview(false);
      setDrawingVertices([]);
      setComputeRequestKey(0);
      setAppMode("paused-drawing");
    }
  }, [history, ignitionPoint, currentStep]);

  const handleBoundaryClose = useCallback(
    async (polygon: LatLng[]) => {
      if (!pausedGrid || !ignitionPoint) return;
      setBoundaryPolygon(polygon);
      setAppMode("paused-computing");
      try {
        const fuelArr = activeFuelMap ? Array.from(activeFuelMap) : [];
        // 60 steps is plenty to see if the polygon holds — that's 3 hours of
        // simulated fire at the default 3-minute timestep, well past the
        // deployment delay window for any realistic resource arrival.
        const remainingSteps = 60;
        const maxSteps = pausedStep + remainingSteps;
        const result = await apiQBoundary({
          config: activeConfig,
          fuelMap: fuelArr,
          elevationMap: undefined,
          centerLat: ignitionPoint.lat,
          centerLng: ignitionPoint.lng,
          initialGrid: pausedGrid,
          initialStep: pausedStep,
          polygon,
          maxSteps,
          modelConfig: {
            breachTolerancePct: modelConfig.breachTolerancePct,
            searchCeilingChainsHr: modelConfig.searchCeilingChainsHr,
            rosterOverrides: {
              dozerChainsHr: modelConfig.dozerChainsHr,
              crewChainsHr: modelConfig.crewChainsHr,
            },
            availableTypes,
          },
        });
        setBoundaryResult(result);
        setAppMode("paused-recommendation");
      } catch (err) {
        console.error("findMinRosterForBoundary failed:", err);
        setAppMode("simulation");
        alert(
          `Containment search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [pausedGrid, pausedStep, ignitionPoint, activeConfig, activeFuelMap, history.baseline.length, modelConfig, availableTypes],
  );

  // Track which modelConfig snapshot the current recommendation was computed
  // with. RecommendationCard reads this to show whether parameters have
  // diverged from the result on screen — and whether the Recompute button
  // should be enabled.
  const lastComputeConfigRef = useRef<typeof modelConfig | null>(null);
  useEffect(() => {
    if (!boundaryResult) {
      lastComputeConfigRef.current = null;
      return;
    }
    if (lastComputeConfigRef.current === null) {
      lastComputeConfigRef.current = modelConfig;
    }
  }, [boundaryResult, modelConfig]);

  const recomputeNeeded =
    lastComputeConfigRef.current !== null &&
    lastComputeConfigRef.current !== modelConfig;

  const handleRecompute = useCallback(() => {
    if (!boundaryPolygon) return;
    lastComputeConfigRef.current = modelConfig;
    handleBoundaryClose(boundaryPolygon);
  }, [boundaryPolygon, modelConfig, handleBoundaryClose]);

  const handleApproveRoster = useCallback(
    async (roster: ResourceCount[]) => {
      if (!pausedGrid || !ignitionPoint || !boundaryPolygon) return;
      const responseDelayMin = pausedStep * activeConfig.timestepMinutes;
      setSuppressionResources(roster);
      setSuppressionDelay(responseDelayMin);
      // Stay in "simulation" mode so the existing suppressionActive gate +
      // convertSimulationToFire effect both fire on the new history. The
      // "simulation-resumed" enum was a transient label; nothing else gates
      // on it, so we just keep the mode as "simulation".
      try {
        const fuelArr = activeFuelMap ? Array.from(activeFuelMap) : [];
        // Resume window length is user-tunable via Model Details panel.
        // Default 30 steps (90 sim-min at 3-min steps).
        const remainingSteps = modelConfig.resumeWindowSteps;
        const maxSteps = pausedStep + remainingSteps;
        const extended = await apiExtend({
          config: activeConfig,
          fuelMap: fuelArr,
          centerLat: ignitionPoint.lat,
          centerLng: ignitionPoint.lng,
          initialGrid: pausedGrid,
          initialStep: pausedStep,
          suppression: { responseDelayMin, resources: roster },
          maxSteps,
        });

        // Decode the returned RLE steps. Each step matches the timestep it
        // represents (extendSimulation emits history starting at initialStep).
        const gridCells = activeConfig.gridSize * activeConfig.gridSize;
        const resumedStates = extended.rleSteps.map((rle, i) => ({
          grid: rleDecode(rle, gridCells),
          timestep: pausedStep + i,
        }));

        // Stitch: pre-pause baseline (suppression-free) + resumed history
        // (with suppression). The first resumedStates entry IS the snapshot
        // at pausedStep, so drop it to avoid duplication with baseline[pausedStep].
        const stitchedSuppressed = [
          ...history.baseline.slice(0, pausedStep + 1),
          ...resumedStates.slice(1),
        ];

        // Pad pre-pause diags with zeros so per-step indexing lines up with
        // suppressed history. extended.diags only covers post-pause steps.
        const preDiags = Array.from({ length: pausedStep + 1 }, (_, step) => ({
          step,
          cumulativeLineMeters: 0,
          activePerimeterMeters: 0,
          containmentProbability: 0,
          resourcesActive: 0,
          newFirelineCells: 0,
        }));
        const stitchedDiags = [...preDiags, ...extended.diags];

        setHistory({
          baseline: history.baseline,
          suppressed: stitchedSuppressed,
          diags: stitchedDiags,
        });
        // Drop the polygon-draw scaffolding so the recommendation card and
        // computing modal unmount cleanly.
        setBoundaryResult(null);
        // Anchor the timeline at the paused step so the user sees the
        // deployment moment first, not the end of the resumed sim.
        setCurrentStep(pausedStep);
        // Transition back to "simulation" mode so the TimelineBar remounts,
        // the convertSimulationToFire effect fires (rebuilds activeFire with
        // the longer stitched history), and suppressionActive flips true so
        // the cyan rim / vehicle / HUD layers all activate.
        setAppMode("simulation");
        // Force autoplay to restart by toggling false → true. autoPlay was
        // already true from the original wildfire-only sim, so a single
        // setAutoPlay(true) wouldn't trigger TimelineBar's deps-based effect.
        setAutoPlay(false);
        setTimeout(() => setAutoPlay(true), 50);
      } catch (err) {
        console.error("apiExtend failed:", err);
        alert(
          `Resume sim failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [
      pausedGrid,
      pausedStep,
      ignitionPoint,
      boundaryPolygon,
      activeConfig,
      activeFuelMap,
      history.baseline,
      setHistory,
      modelConfig,
    ],
  );

  const handleSuppressionCancel = useCallback(() => {
    setBoundaryPolygon(null);
    setBoundaryResult(null);
    setPausedGrid(null);
    setShowBreachPreview(false);
    setDrawingVertices([]);
    setComputeRequestKey(0);
    setAppMode("simulation");
  }, []);

  const handleRedrawBoundary = useCallback(() => {
    setBoundaryPolygon(null);
    setBoundaryResult(null);
    setShowBreachPreview(false);
    setDrawingVertices([]);
    setComputeRequestKey(0);
    setAppMode("paused-drawing");
  }, []);

  // ── Robot-dog mock simulation ─────────────────────────────────────────
  // Plans on history.baseline (the forecast on screen when no suppression is
  // active). Stays in appMode "simulation" so the activeFire rebuild effect
  // keeps working after the wind-shift re-forecast.
  const robotConfig: RobotConfig = ROBOT_DEFAULTS;
  const robotActive = robot !== null;
  const plannerGrid: PlannerGrid | null = useMemo(() => {
    if (!robotActive || history.baseline.length === 0) return null;
    return {
      gridSize: activeConfig.gridSize,
      cellSizeMeters: activeConfig.cellSizeMeters,
      ignitionMin: computeIgnitionMinutes(history.baseline, activeConfig.timestepMinutes),
      elevation: elevationMap ?? undefined,
      passable: passableFromFuel(activeFuelMap, activeConfig.gridSize),
    };
  }, [robotActive, history.baseline, elevationMap, activeFuelMap, activeConfig.gridSize, activeConfig.cellSizeMeters, activeConfig.timestepMinutes]);

  const robotNowMin = currentStep * activeConfig.timestepMinutes;

  // Bring the mission to the current timeline minute (forward, backward, or after a re-forecast).
  useEffect(() => {
    if (!plannerGrid) return;
    setRobot((r) => {
      if (!r || r.log.length === 0) return r;
      const log = syncMission(r.log, robotNowMin, activeConfig.timestepMinutes, () => plannerGrid, robotConfig);
      if (log === r.log) return r;
      const mission = log[log.length - 1].mission;
      return { ...r, log, mission, lastEvent: mission.event ?? r.lastEvent };
    });
  }, [robotNowMin, plannerGrid, robotConfig, activeConfig.timestepMinutes]);

  const resumePlayback = useCallback(() => {
    setAutoPlay(false);
    setTimeout(() => setAutoPlay(true), 50);
  }, []);

  /** Grid cell for a clicked point, snapped to safety; or a message why not. */
  const resolveRobotPick = useCallback(
    (lat: number, lng: number): { idx: number | null; notice: string | null } => {
      if (!plannerGrid || !ignitionPoint) return { idx: null, notice: "Simulation not ready" };
      const raw = latLngToCell(
        lat, lng, plannerGrid.gridSize, plannerGrid.cellSizeMeters, ignitionPoint.lat, ignitionPoint.lng,
      );
      if (raw === null) return { idx: null, notice: "Outside the simulation area" };
      const idx = snapToSafeCell(raw, plannerGrid, robotNowMin, robotConfig.entryMarginMin, robotConfig.snapRadiusCells);
      if (idx === null) return { idx: null, notice: "Not safe here — pick a spot away from the fire" };
      return { idx, notice: idx === raw ? null : "Moved to the nearest safe spot" };
    },
    [plannerGrid, ignitionPoint, robotNowMin, robotConfig],
  );

  /** Start a mission from two cells; returns an error notice or null. */
  const launchMission = useCallback(
    (stagingIdx: number, targetIdx: number, notice: string | null): string | null => {
      if (!plannerGrid) return "Simulation not ready";
      const mission = createMission(stagingIdx, targetIdx, robotNowMin, plannerGrid, robotConfig);
      if (!mission.route) return "No safe route to that target — pick another";
      // The timeline stops at its last frame; a mission that outlasts it would freeze.
      const horizonMin = activeFire ? (activeFire.frames.length - 1) * activeConfig.timestepMinutes : 0;
      if (!missionFitsForecast(mission, horizonMin, robotConfig)) {
        return "Not enough forecast left for this mission — scrub earlier and try again";
      }
      setRobot((r) => r && {
        ...r, placing: null, stagingIdx, targetIdx, mission, notice, lastEvent: null,
        log: [{ min: robotNowMin, mission, grid: plannerGrid }],
      });
      resumePlayback();
      return null;
    },
    [plannerGrid, robotNowMin, robotConfig, resumePlayback, activeFire, activeConfig.timestepMinutes],
  );

  const handleRobotPick = useCallback(
    (lat: number, lng: number) => {
      if (!robot?.placing) return;
      const { idx, notice } = resolveRobotPick(lat, lng);
      if (idx === null) {
        setRobot((r) => r && { ...r, notice });
        return;
      }
      if (robot.placing === "staging") {
        setRobot((r) => r && { ...r, placing: "target", stagingIdx: idx, notice });
        return;
      }
      const err = launchMission(robot.stagingIdx!, idx, notice);
      if (err) setRobot((r) => r && { ...r, notice: err });
    },
    [robot, resolveRobotPick, launchMission],
  );

  const handleRobotStart = useCallback(() => {
    setRobot({
      placing: "staging", stagingIdx: null, targetIdx: null, mission: null, log: [],
      windShifted: false, shiftPending: false, notice: null, lastEvent: null,
    });
  }, []);

  const handleRobotExit = useCallback(() => {
    // Keeps the (possibly wind-shifted) fire; no second history is held.
    setRobot(null);
    setRobotFollow(false);
  }, []);

  const handleWindShift = useCallback(async () => {
    const r = robot;
    if (!r?.mission || r.mission.phase === "done" || r.windShifted || r.shiftPending || !ignitionPoint) return;
    const n = activeConfig.gridSize;
    const step = Math.min(currentStep, history.baseline.length - 1);
    const snapshot = history.baseline[step].grid;
    const centroid = burningCentroid(snapshot, n);
    if (!centroid) {
      setRobot((s) => s && { ...s, notice: "No active fire to shift the wind toward" });
      return;
    }
    const pose = missionPose(r.mission, step * activeConfig.timestepMinutes, n);
    const dogIdx = Math.round(pose.row) * n + Math.round(pose.col);
    const wind = shiftedWind(dogIdx, centroid, n, activeConfig, robotConfig.windShiftDeltaKmh);
    const newConfig = { ...activeConfig, ...wind };

    setRobot((s) => s && { ...s, shiftPending: true, notice: null });
    setAutoPlay(false);
    try {
      const extended = await apiExtend({
        config: newConfig,
        fuelMap: activeFuelMap ? Array.from(activeFuelMap) : [],
        elevationMap: elevationMap ? Array.from(elevationMap) : undefined,
        centerLat: ignitionPoint.lat,
        centerLng: ignitionPoint.lng,
        initialGrid: new Uint8Array(snapshot),
        initialStep: step,
        suppression: null,
        // One sim day past the shift. Longer windows (hundreds of 600×600
        // steps decoded on top of the baseline) crashed the tab in testing.
        maxSteps: step + WIND_SHIFT_WINDOW_STEPS,
      });
      const gridCells = n * n;
      const resumed = extended.rleSteps.map((rle, i) => ({
        grid: rleDecode(rle, gridCells),
        timestep: step + i,
      }));
      // Trim, commit, then append (see tailReplaceCommits): replacing the tail
      // in one render froze the tab in dev.
      const [trimmed, stitched] = tailReplaceCommits(history.baseline, step, resumed);
      flushSync(() => setHistory({ baseline: trimmed }));
      setHistory({ baseline: stitched });
      setActiveConfig(newConfig);
      const label = `Wind shifted to ${Math.round(wind.windDirection)}° at ${Math.round(wind.windSpeed)} km/h — fire re-forecast`;
      setWeatherInfo(label);
      setCurrentStep(step);
      setRobot((s) => s && { ...s, windShifted: true, shiftPending: false, lastEvent: label });
    } catch (err) {
      console.error("Wind shift re-forecast failed:", err);
      setRobot((s) => s && {
        ...s, shiftPending: false, notice: "Wind shift failed — is the dev server running? (npm run server)",
      });
    }
    resumePlayback();
  }, [robot, ignitionPoint, activeConfig, currentStep, history.baseline, activeFuelMap, elevationMap, robotConfig, setHistory, resumePlayback]);

  // Dev-only hooks for the scripted recording (docs/poster/scripts/record_robot_demo.py).
  const robotRef = useRef(robot);
  robotRef.current = robot;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__robotDemo = {
      start(staging, target) {
        // Requires robot mode (the "🐕 Robot Dog" button) so the planner grid exists.
        if (!robotRef.current) return "robot mode is not active";
        const s = resolveRobotPick(staging.lat, staging.lng);
        const t = resolveRobotPick(target.lat, target.lng);
        if (s.idx === null) return `staging: ${s.notice}`;
        if (t.idx === null) return `target: ${t.notice}`;
        return launchMission(s.idx, t.idx, s.notice ?? t.notice);
      },
      shiftWind: handleWindShift,
      state: () => {
        const m = robotRef.current?.mission ?? null;
        return { phase: m?.phase ?? null, replanCount: m?.replanCount ?? 0, event: robotRef.current?.lastEvent ?? null };
      },
      info: () => {
        if (!ignitionPoint || history.baseline.length === 0) return null;
        const grid = history.baseline[Math.min(currentStep, history.baseline.length - 1)].grid;
        let burningCells = 0;
        for (let i = 0; i < grid.length; i++) if (grid[i] === 1) burningCells++;
        const n = activeConfig.gridSize;
        const centroid = burningCentroid(grid, n);
        const b = ((activeConfig.windDirection + 180) * Math.PI) / 180;
        let headEdgeCells = 0;
        if (centroid) {
          for (let k = 0, clear = 0; k < n && clear < 5; k++) {
            const r = Math.round(centroid.row + k * Math.cos(b));
            const c = Math.round(centroid.col + k * Math.sin(b));
            if (r < 0 || r >= n || c < 0 || c >= n) break;
            if (grid[r * n + c] === 0) clear++;
            else { clear = 0; headEdgeCells = k; }
          }
        }
        return {
          baselineLength: history.baseline.length,
          headEdgeCells,
          center: ignitionPoint,
          gridSize: activeConfig.gridSize,
          cellSizeMeters: activeConfig.cellSizeMeters,
          windDirection: activeConfig.windDirection,
          step: currentStep,
          centroid,
          burningCells,
        };
      },
    };
  }, [resolveRobotPick, launchMission, handleWindShift, ignitionPoint, history.baseline, currentStep, activeConfig]);

  // Bridges the ControlPanel's existing onStart prop into the new flow:
  // - If a pin is placed, this is the "Start the Wildfire" action and we
  //   actually launch the simulation at the pinned location.
  // - Otherwise (no pin yet), the button is purely instructional; the
  //   click is a no-op besides updating local config in ControlPanel.
  const handleStart = useCallback(
    (config: SimulationConfig) => {
      setActiveConfig(config);
      if (pendingIgnition) {
        handleStartWildfire(pendingIgnition.lat, pendingIgnition.lng);
      }
    },
    [pendingIgnition, handleStartWildfire],
  );

  const handleLocationSelected = useCallback(
    (lat: number, lng: number, label: string) => {
      // Just fly the camera. The user still chooses where to drop the
      // ignition pin by clicking the globe.
      setFlyTo({ lat, lng, altitude: 15000, _t: Date.now() });
      setLocationDisplay(label);
    },
    [],
  );

  const handleWeatherSourceChange = useCallback((source: "live" | "seasonal" | "custom", season?: Season) => {
    weatherSourceRef.current = { source, season };
    if (source === "seasonal" && season) {
      const weather = getSeasonalWeather(0, season);
      setWeatherInfo(`${season}: ${weather.windSpeed} km/h wind, ${weather.humidity}% humidity`);
      setActiveConfig((prev) => ({
        ...prev,
        windSpeed: weather.windSpeed,
        windDirection: weather.windDirection,
        humidity: weather.humidity,
      }));
    } else {
      setWeatherInfo("Will fetch live weather when you click the globe");
    }
  }, []);

  const handleStartHistorical = useCallback(
    async (fireId: string) => {
      runReset();
      setAppMode("historical");
      const fire = await loadHistoricalFire(fireId);
      setActiveFire(fire);
      setFlyTo({ ...fire.location, _t: Date.now() });
      setCurrentStep(0);
      setTimeout(() => setAutoPlay(true), 1500);
    },
    [runReset]
  );

  const totalSteps = activeFire ? activeFire.frames.length : 0;
  const dateLabels = activeFire ? activeFire.frames.map((f) => f.date) : undefined;
  const isHistorical = appMode === "historical";

  // Throttle the canvas-imagery layers (ContainmentLineLayer +
  // GhostFireOverlay) to repaint every 3 steps instead of every step.
  // Each repaint is a full 600x600 canvas + PNG encode + GPU texture upload;
  // doing that at autoplay's 5 Hz over 100+ steps OOMs the tab. The cyan
  // rim grows incrementally so missing intermediate steps is invisible.
  const SNAPSHOT_STRIDE = 5;
  const throttledStep = Math.floor(currentStep / SNAPSHOT_STRIDE) * SNAPSHOT_STRIDE;

  const baselineSnapshot =
    history.baseline.length > 0
      ? history.baseline[Math.min(throttledStep, history.baseline.length - 1)].grid
      : null;
  const suppressedSnapshot =
    history.suppressed && history.suppressed.length > 0
      ? history.suppressed[Math.min(throttledStep, history.suppressed.length - 1)].grid
      : null;

  // Suppression run is active when we have both a suppressed history and ignition point.
  const suppressionActive =
    appMode === "simulation" &&
    ignitionPoint !== null &&
    history.suppressed !== undefined &&
    history.suppressed.length > 0 &&
    suppressionResources.length > 0;

  const deployStep = Math.ceil(suppressionDelay / activeConfig.timestepMinutes);
  const suppressionEndStep =
    history.suppressed && history.suppressed.length > 0
      ? history.suppressed.length - 1
      : 0;

  // Stable suppression-config object — without memoization a fresh
  // {responseDelayMin, resources} reference would land in every layer/HUD on
  // every render, causing the SuppressionVehicleLayer effects to clear and
  // re-add Cesium billboards at parent-render rate (sometimes 60 Hz under
  // autoplay). That churn was the OOM trigger when paired with HMR-leaked
  // primitives.
  const suppressionConfig = useMemo(
    () => ({ responseDelayMin: suppressionDelay, resources: suppressionResources }),
    [suppressionDelay, suppressionResources],
  );

  const dropEvents: DropEvent[] = useMemo(() => {
    if (!suppressionActive || !ignitionPoint || !history.suppressed) return [];
    return dropScheduler(
      history.suppressed,
      activeConfig,
      ignitionPoint.lat,
      ignitionPoint.lng,
      suppressionConfig,
      deployStep,
    );
  }, [suppressionActive, history.suppressed, activeConfig, ignitionPoint?.lat, ignitionPoint?.lng, suppressionConfig, deployStep]);

  // Derive a short bundle label by total resource count (the four canonical bundles have unique totals).
  const bundleLabel = useMemo(() => {
    const total = suppressionResources.reduce((s, r) => s + r.count, 0);
    if (total === 0) return "None";
    if (total === 3) return "Initial Attack";
    if (total === 7) return "Type 3";
    if (total === 11) return "Type 2";
    if (total === 20) return "Type 1";
    return "Custom";
  }, [suppressionResources]);

  const suppressedCurrIdx = Math.min(currentStep, suppressionEndStep);

  return (
    <InfoModalProvider>
    <div className="h-screen w-screen relative">
      <GlobeView
        onIgnite={isRunning || appMode === "historical" || robot ? undefined : handlePlacePin}
        flyTo={flyTo}
        onViewerReady={handleViewerReady}
      />

      <IgnitionPin
        viewer={viewerRef.current}
        position={
          appMode.startsWith("paused-") ? null : pendingIgnition ?? ignitionPoint
        }
      />

      {activeFuelMap && ignitionPoint && appMode === "simulation" && (
        <WaterOverlay
          key={`water-${simKey}`}
          fuelMap={activeFuelMap}
          centerLat={ignitionPoint.lat}
          centerLng={ignitionPoint.lng}
          config={activeConfig}
          viewer={viewerRef.current}
        />
      )}

      {suppressedSnapshot && ignitionPoint && (
        <ContainmentLineLayer
          key={`containment-${simKey}`}
          gridSnapshot={suppressedSnapshot}
          centerLat={ignitionPoint.lat}
          centerLng={ignitionPoint.lng}
          config={activeConfig}
          viewer={viewerRef.current}
        />
      )}

      {/* On-map resource simulation (RetardantTrailLayer + SuppressionVehicleLayer)
          removed by user request. The HUD readout + cyan containment rim
          carry the suppression story; on-map glTF lineups and tanker drop
          passes added visual noise without operational value. */}

      {/* GhostFireOverlay disabled during the IC-recommend resume flow.
          The boundary-set state means we entered via Suggest Containment;
          in that flow the cyan rim from ContainmentLineLayer carries the
          containment story and the counterfactual overlay just adds GPU
          cost (full grid diff per repaint). */}
      {baselineSnapshot && suppressedSnapshot && ignitionPoint && !boundaryPolygon && (
        <GhostFireOverlay
          key={`ghost-${simKey}`}
          baselineSnapshot={baselineSnapshot}
          suppressedSnapshot={suppressedSnapshot}
          centerLat={ignitionPoint.lat}
          centerLng={ignitionPoint.lng}
          config={activeConfig}
          viewer={viewerRef.current}
        />
      )}

      {activeFire && (
        <>
          <HistoricalFireOverlay
            key={`fire-${simKey}`}
            fire={activeFire}
            currentFrame={currentStep}
            viewer={viewerRef.current}
          />
          {/* Stable key — was `effects-${simKey}-${currentStep}` which
              forced a full Cesium ParticleSystem unmount + remount on every
              timeline tick. At autoplay 5 Hz that churned thousands of
              GPU particle buffers per minute and OOMed the tab during
              long resumed-suppression playbacks. The internal useEffect
              still picks up new activePositions; only the React shell is
              now stable. */}
          <FireEffects
            key={`effects-${simKey}`}
            activePositions={
              activeFire.frames[currentStep]?.hotspots.map((h) => ({ lat: h.lat, lng: h.lng })) ?? []
            }
            viewer={viewerRef.current}
          />
        </>
      )}

      {suppressionActive && history.suppressed && history.diags && (
        <div className="absolute top-[200px] right-3 z-40 pointer-events-none">
          <div className="pointer-events-auto">
            <SuppressionHUD
              diags={history.diags}
              config={activeConfig}
              suppression={suppressionConfig}
              deployStep={deployStep}
              endStep={suppressionEndStep}
              currentStep={suppressedCurrIdx}
              dropEvents={dropEvents}
              bundleLabel={bundleLabel}
            />
          </div>
        </div>
      )}

      {viewerRef.current && (
        <BoundaryDrawTool
          viewer={viewerRef.current}
          active={appMode === "paused-drawing"}
          onClose={handleBoundaryClose}
          onCancel={handleSuppressionCancel}
          onValidationError={(msg) => console.warn(msg)}
          onVerticesChange={setDrawingVertices}
          closeRequest={computeRequestKey}
        />
      )}

      {viewerRef.current && boundaryPolygon && (
        <PolygonOverlay
          viewer={viewerRef.current}
          polygon={boundaryPolygon}
          contained={false}
        />
      )}

      {appMode === "paused-recommendation" && boundaryResult && (
        <RecommendationCard
          result={boundaryResult}
          timestepMinutes={activeConfig.timestepMinutes}
          onApprove={handleApproveRoster}
          onShowBreachPreview={() => setShowBreachPreview((v) => !v)}
          onCancel={handleSuppressionCancel}
          onRedraw={handleRedrawBoundary}
          onRecompute={handleRecompute}
          recomputeNeeded={recomputeNeeded}
        />
      )}

      {appMode === "paused-computing" && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div
            className="fire-panel rounded-lg p-6 text-center text-amber-400 min-w-[360px]"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <div className="mb-3 text-label uppercase tracking-wide">
              Searching minimum effective response
            </div>
            <div className="text-caption text-gray-400 mb-4">
              Bisecting on chains/hr capacity… ~5–15s
            </div>
            <div className="h-1.5 w-full bg-amber-500/15 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full animate-progress-stripe" />
            </div>
          </div>
        </div>
      )}

      {appMode === "paused-drawing" && (
        <ResourceAvailability
          available={availableTypes}
          onChange={setAvailableTypes}
          className="absolute bottom-[72px] left-3 right-3 z-50"
        />
      )}

      {appMode === "paused-drawing" && (
        <div
          className="absolute bottom-3 left-3 right-3 z-50 fire-panel rounded-xl px-4 py-3 flex items-center gap-3"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <span className="text-amber-400 text-label uppercase tracking-wide">
            Draw Containment Boundary
          </span>
          <span className="text-gray-400 text-caption flex-1">
            Click to place vertex · drag a vertex to adjust · right-click to undo · Esc to cancel
          </span>
          <span className="text-gray-300 text-sm tabular-nums">
            {drawingVertices.length} vertices
          </span>
          <button
            type="button"
            onClick={() => setComputeRequestKey((k) => k + 1)}
            disabled={drawingVertices.length < 3 || availableTypes.length === 0}
            title={
              availableTypes.length === 0
                ? "Select at least one available resource type"
                : drawingVertices.length < 3
                  ? "Place at least 3 boundary vertices"
                  : "Compute the minimum effective response"
            }
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              drawingVertices.length >= 3 && availableTypes.length > 0
                ? "bg-amber-500/30 text-amber-200 hover:bg-amber-500/40 cursor-pointer"
                : "bg-white/5 text-gray-500 cursor-not-allowed"
            }`}
          >
            Compute
          </button>
          <button
            type="button"
            onClick={handleSuppressionCancel}
            className="px-3 py-1.5 text-caption rounded border border-amber-500/30
              bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
          >
            Cancel
          </button>
        </div>
      )}

      {appMode === "simulation"
        && !timelinePlaying
        && !history.suppressed
        && !robot
        && history.baseline.length > 0 && (
        <>
          <button
            type="button"
            onClick={handleSuggestContainment}
            className="absolute bottom-[80px] left-3 z-50 fire-panel rounded-lg px-4 py-2
              text-amber-400 text-sm font-medium hover:bg-amber-500/15 transition-colors"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            🛡 Suggest Containment
          </button>
          <button
            type="button"
            onClick={handleRobotStart}
            className="absolute bottom-[130px] left-3 z-50 fire-panel rounded-lg px-4 py-2
              text-sky-400 text-sm font-medium hover:bg-sky-500/15 transition-colors"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            🐕 Robot Dog
          </button>
        </>
      )}

      {robot && ignitionPoint && (
        <>
          <RobotDogLayer
            viewer={viewerRef.current}
            mission={robot.mission}
            nowMin={robotNowMin}
            playing={timelinePlaying}
            timestepMinutes={activeConfig.timestepMinutes}
            gridSize={activeConfig.gridSize}
            cellSizeMeters={activeConfig.cellSizeMeters}
            centerLat={ignitionPoint.lat}
            centerLng={ignitionPoint.lng}
            follow={robotFollow}
            pendingStagingIdx={robot.stagingIdx}
          />
          <RobotPlacementTool
            viewer={viewerRef.current}
            active={robot.placing !== null}
            onPick={handleRobotPick}
          />
          <div className="absolute top-[200px] right-3 z-40">
            <RobotDogHUD
              phase={robot.mission?.phase ?? null}
              event={robot.lastEvent}
              marginMin={robot.mission && plannerGrid ? missionMarginMin(robot.mission, robotNowMin, plannerGrid) : Infinity}
              windLabel={`Wind: from ${Math.round(activeConfig.windDirection)}° at ${Math.round(activeConfig.windSpeed)} km/h`}
              windShifted={robot.windShifted}
              shiftPending={robot.shiftPending}
              onWindShift={handleWindShift}
              onExit={handleRobotExit}
              follow={robotFollow}
              onToggleFollow={() => setRobotFollow((f) => !f)}
              notice={[robot.placing ? ROBOT_PROMPT[robot.placing] : null, robot.notice].filter(Boolean).join(" · ") || null}
            />
          </div>
        </>
      )}

      <ControlPanel
        onStart={handleStart}
        onStartHistorical={handleStartHistorical}
        onScenarioPick={handleScenarioPick}
        onScenarioLive={handleScenarioLive}
        onReset={fullReset}
        onWeatherSourceChange={handleWeatherSourceChange}
        onLocationSelected={handleLocationSelected}
        isRunning={isRunning || isPreparingSim}
        hasPendingIgnition={pendingIgnition !== null}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        weatherInfo={weatherInfo}
        fire={activeFire}
        currentFrame={currentStep}
        showImpact={totalSteps > 0}
        suppressionDelay={suppressionDelay}
        suppressionResources={suppressionResources}
        onSuppressionChange={handleSuppressionChange}
        suppressionDiags={history.diags}
        baselineHistory={history.baseline}
        suppressedHistory={history.suppressed}
        analysis={activeScenario?.analysis}
        thresholdAreaHa={activeScenario?.meta.thresholdAreaHa}
        nearbyResources={nearbyResources ?? undefined}
        locationDisplay={locationDisplay}
      />

      {!appMode.startsWith("paused-") && (
        <TimelineBar
          totalSteps={totalSteps}
          currentStep={currentStep}
          onStepChange={setCurrentStep}
          timestepMinutes={activeConfig.timestepMinutes}
          dateLabels={dateLabels}
          autoPlay={autoPlay}
          onPlayingChange={setTimelinePlaying}
        />
      )}

      <TimeInfoPanel
        currentStep={currentStep}
        timestepMinutes={activeConfig.timestepMinutes}
        visible={totalSteps > 0}
        historicalDates={dateLabels}
        shifted={false}
      />

      <Legend
        mode={isHistorical ? "historical" : "simulation"}
        visible={totalSteps > 0}
      />

      {/* Model Details (parameters + methodology) is now embedded inside
          the RecommendationCard as a collapsible section. No separate
          panel — keeps the methodology context tied to the recommendation
          it pertains to. */}

      {/* Resources reference modal — opened by the Briefing Console. */}
      <ResourcesReference
        isOpen={resourcesReferenceOpen}
        onClose={() => setResourcesReferenceOpen(false)}
      />

      {/* Split-compare trigger — sits just above the Briefing Console
          (which lives at bottom-right) when both histories exist. */}
      {history.suppressed && history.suppressed.length > 0 && history.baseline.length > 0 && ignitionPoint && (
        <button
          type="button"
          onClick={() => setSplitCompareOpen(true)}
          className="fixed bottom-[316px] right-3 z-50 fire-panel rounded-lg
            px-3 py-2 text-caption tracking-[0.18em] uppercase font-medium
            text-amber-400 hover:bg-amber-500/15 hover:text-amber-300
            transition-colors cursor-pointer flex items-center gap-2
            shadow-[0_4px_16px_-4px_rgba(0,0,0,0.5)]"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
          title="Side-by-side comparison: without control vs with control"
        >
          <span aria-hidden="true">⇆</span>
          <span>Compare</span>
        </button>
      )}
      {history.suppressed && history.suppressed.length > 0 && history.baseline.length > 0 && ignitionPoint && (
        <SplitCompareView
          isOpen={splitCompareOpen}
          onClose={() => setSplitCompareOpen(false)}
          baselineHistory={history.baseline}
          suppressedHistory={history.suppressed}
          config={activeConfig}
          ignitionPoint={ignitionPoint}
          fuelMap={activeFuelMap}
          boundaryPolygon={boundaryPolygon}
          currentStep={currentStep}
          onStepChange={setCurrentStep}
          timestepMinutes={activeConfig.timestepMinutes}
          originDate={activeOriginDate}
        />
      )}

      {/* Briefing Console — unified bottom-right info panel. Hidden during
          paused-* flow modes (drawing / computing / recommendation) so it
          doesn't collide with the bottom-edge Compute toolbar or compete
          with the centered RecommendationCard for attention. */}
      {!appMode.startsWith("paused-") && (
        <BriefingConsole
          onOpenResources={() => setResourcesReferenceOpen(true)}
          isResourcesActive={resourcesReferenceOpen}
        />
      )}

      <InfoModal />
    </div>
    </InfoModalProvider>
  );
}

export default App;
