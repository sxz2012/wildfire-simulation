import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import GlobeView from "./components/GlobeView";
import ControlPanel from "./components/ControlPanel";
import TimelineBar from "./components/TimelineBar";
import HistoricalFireOverlay from "./components/HistoricalFireOverlay";
import FireEffects from "./components/FireEffects";
import WaterOverlay from "./components/WaterOverlay";
import ContainmentLineLayer from "./components/ContainmentLineLayer";
import GhostFireOverlay from "./components/GhostFireOverlay";
import RetardantTrailLayer from "./components/RetardantTrailLayer";
import SuppressionVehicleLayer from "./components/SuppressionVehicleLayer";
import SuppressionHUD from "./components/SuppressionHUD";
import IgnitionPin from "./components/IgnitionPin";
import Legend from "./components/Legend";
import { reverseGeocode } from "./components/LocationSearch";
// ImpactPanel is now integrated into ControlPanel as ImpactSection
import TimeInfoPanel from "./components/TimeInfoPanel";
import { useSimulation } from "./simulation/useSimulation";
import { DEFAULT_CONFIG, FuelType, SUPPRESSION_BUNDLES, type SimulationConfig, type ResourceCount } from "./simulation/types";
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

type AppMode = "idle" | "simulation" | "historical";

function App() {
  const { history, isRunning, startSimulation, reset } = useSimulation();
  const [currentStep, setCurrentStep] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>("idle");
  const [ignitionPoint, setIgnitionPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; altitude: number; _t: number } | null>(null);
  const [activeConfig, setActiveConfig] = useState<SimulationConfig>(DEFAULT_CONFIG);
  const [activeFuelMap, setActiveFuelMap] = useState<FuelType[] | null>(null);
  const [activeOriginDate, setActiveOriginDate] = useState<Date | null>(null);
  // Where the user has placed the ignition flame pin but not yet confirmed.
  // Globe clicks update this; the actual simulation only starts when the
  // user clicks the "Start the Wildfire" button in ControlPanel.
  const [pendingIgnition, setPendingIgnition] = useState<{ lat: number; lng: number } | null>(null);
  const [activeScenario, setActiveScenario] = useState<LoadedScenario | null>(null);
  const [suppressionDelay, setSuppressionDelay] = useState(30);
  const [suppressionResources, setSuppressionResources] = useState<ResourceCount[]>(
    SUPPRESSION_BUNDLES.initialAttack,
  );
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
    setActiveOriginDate(null);
    setPendingIgnition(null);
    setAppMode("idle");
    setAutoPlay(false);
    setSimKey((k) => k + 1);
  }, [reset]);

  // Full reset: per-run state plus user inputs returned to defaults. Wired
  // to the explicit Reset button only.
  const fullReset = useCallback(() => {
    runReset();
    setSuppressionDelay(30);
    setSuppressionResources(SUPPRESSION_BUNDLES.initialAttack);
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

  const baselineSnapshot =
    history.baseline.length > 0
      ? history.baseline[Math.min(currentStep, history.baseline.length - 1)].grid
      : null;
  const suppressedSnapshot =
    history.suppressed && history.suppressed.length > 0
      ? history.suppressed[Math.min(currentStep, history.suppressed.length - 1)].grid
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
    <div className="h-screen w-screen relative">
      <GlobeView
        onIgnite={isRunning || appMode === "historical" ? undefined : handlePlacePin}
        flyTo={flyTo}
        onViewerReady={handleViewerReady}
      />

      <IgnitionPin
        viewer={viewerRef.current}
        position={pendingIgnition ?? ignitionPoint}
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

      {suppressionActive && history.suppressed && ignitionPoint && (
        <>
          <RetardantTrailLayer
            key={`retardant-${simKey}`}
            viewer={viewerRef.current}
            dropEvents={dropEvents}
            currentStep={suppressedCurrIdx}
            timestepMinutes={activeConfig.timestepMinutes}
          />
          <SuppressionVehicleLayer
            key={`vehicles-${simKey}`}
            viewer={viewerRef.current}
            prev={
              currentStep > 0
                ? history.suppressed[Math.min(currentStep - 1, suppressionEndStep)]
                : null
            }
            curr={history.suppressed[suppressedCurrIdx]}
            config={activeConfig}
            centerLat={ignitionPoint.lat}
            centerLng={ignitionPoint.lng}
            suppression={suppressionConfig}
            deployStep={deployStep}
            endStep={suppressionEndStep}
            currentStep={suppressedCurrIdx}
            dropEvents={dropEvents}
          />
        </>
      )}

      {baselineSnapshot && suppressedSnapshot && ignitionPoint && (
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
          <FireEffects
            key={`effects-${simKey}-${currentStep}`}
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

      <TimelineBar
        totalSteps={totalSteps}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        timestepMinutes={activeConfig.timestepMinutes}
        dateLabels={dateLabels}
        autoPlay={autoPlay}
      />

      <TimeInfoPanel
        currentStep={currentStep}
        timestepMinutes={activeConfig.timestepMinutes}
        visible={totalSteps > 0}
        historicalDates={dateLabels}
      />

      <Legend
        mode={isHistorical ? "historical" : "simulation"}
        visible={totalSteps > 0}
      />
    </div>
  );
}

export default App;
