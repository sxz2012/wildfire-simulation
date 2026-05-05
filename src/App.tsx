import { useState, useCallback, useRef, useEffect } from "react";
import GlobeView from "./components/GlobeView";
import ControlPanel from "./components/ControlPanel";
import TimelineBar from "./components/TimelineBar";
import HistoricalFireOverlay from "./components/HistoricalFireOverlay";
import FireEffects from "./components/FireEffects";
import WaterOverlay from "./components/WaterOverlay";
import IgnitionPin from "./components/IgnitionPin";
import Legend from "./components/Legend";
// ImpactPanel is now integrated into ControlPanel as ImpactSection
import TimeInfoPanel from "./components/TimeInfoPanel";
import { useSimulation } from "./simulation/useSimulation";
import { DEFAULT_CONFIG, FuelType, type SimulationConfig } from "./simulation/types";
import { convertSimulationToFire } from "./simulation/convertToFrames";
import { loadHistoricalFire, type HistoricalFire } from "./data/historicalFires";
import { fetchCurrentWeather, getSeasonalWeather, type Season, type WeatherData } from "./services/weather";
import { sampleVegetation } from "./services/vegetation";
import { sampleElevations } from "./services/terrain";
import { sampleLandCover } from "./services/landCover";
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
  // True between "Start the Wildfire" being clicked and the worker actually
  // running. Bridges the async gap (weather + land cover + terrain fetches)
  // so the button reads "Simulating..." continuously instead of flashing
  // back to "Click Globe to Ignite" during loading.
  const [isPreparingSim, setIsPreparingSim] = useState(false);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const [simKey, setSimKey] = useState(0);
  const [activeFire, setActiveFire] = useState<HistoricalFire | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [weatherInfo, setWeatherInfo] = useState<string>("");
  const weatherSourceRef = useRef<{ source: "live" | "seasonal" | "custom"; season?: Season }>({ source: "live" });

  const handleViewerReady = useCallback((viewer: CesiumViewer) => {
    viewerRef.current = viewer;
  }, []);

  const fullReset = useCallback(() => {
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

  // Convert simulation history to fire frames when the worker finishes a run.
  // Implemented as a real effect (rather than an inline render-time side effect)
  // so it always fires for each new run, regardless of how step counts compare
  // to the previous one. The earlier ref-based gate could silently no-op when
  // a second simulation produced the same number of steps as the first.
  useEffect(() => {
    if (appMode !== "simulation") return;
    if (history.length === 0) return;
    if (!ignitionPoint) return;
    const fire = convertSimulationToFire(
      history,
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
      if (appMode === "simulation") fullReset();
      setPendingIgnition({ lat, lng });
      setFlyTo({ lat, lng, altitude: 15000, _t: Date.now() });
    },
    [appMode, fullReset],
  );

  const handleStartWildfire = useCallback(
    async (lat: number, lng: number) => {
      setIsPreparingSim(true);
      fullReset();
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

      startSimulation(config, center, center, lat, lng, fuelMap, {
        tempMean: weather.temperature,
        tempMax: weather.temperature + 5,
        precipitation: 0,
        cumulativePrecip: 0,
      }, undefined, elevationMap);
      setIsPreparingSim(false);
    },
    [fullReset, startSimulation]
  );

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
      fullReset();
      setAppMode("historical");
      const fire = await loadHistoricalFire(fireId);
      setActiveFire(fire);
      setFlyTo({ ...fire.location, _t: Date.now() });
      setCurrentStep(0);
      setTimeout(() => setAutoPlay(true), 1500);
    },
    [fullReset]
  );

  const totalSteps = activeFire ? activeFire.frames.length : 0;
  const dateLabels = activeFire ? activeFire.frames.map((f) => f.date) : undefined;
  const isHistorical = appMode === "historical";

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

      <ControlPanel
        onStart={handleStart}
        onStartHistorical={handleStartHistorical}
        onReset={fullReset}
        onWeatherSourceChange={handleWeatherSourceChange}
        isRunning={isRunning || isPreparingSim}
        hasPendingIgnition={pendingIgnition !== null}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        weatherInfo={weatherInfo}
        fire={activeFire}
        currentFrame={currentStep}
        showImpact={totalSteps > 0}
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
