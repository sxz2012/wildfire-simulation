import { useState, useCallback, useRef } from "react";
import GlobeView from "./components/GlobeView";
import ControlPanel from "./components/ControlPanel";
import TimelineBar from "./components/TimelineBar";
import HistoricalFireOverlay from "./components/HistoricalFireOverlay";
import FireEffects from "./components/FireEffects";
import Legend from "./components/Legend";
import TimeInfoPanel from "./components/TimeInfoPanel";
import { useSimulation } from "./simulation/useSimulation";
import { DEFAULT_CONFIG, type SimulationConfig } from "./simulation/types";
import { convertSimulationToFire } from "./simulation/convertToFrames";
import { loadHistoricalFire, type HistoricalFire } from "./data/historicalFires";
import { fetchCurrentWeather, getSeasonalWeather, type Season, type WeatherData } from "./services/weather";
import { sampleVegetation } from "./services/vegetation";
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
  const viewerRef = useRef<CesiumViewer | null>(null);
  const [simKey, setSimKey] = useState(0);
  const [activeFire, setActiveFire] = useState<HistoricalFire | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [weatherInfo, setWeatherInfo] = useState<string>("");
  const weatherSourceRef = useRef<{ source: "live" | "seasonal"; season?: Season }>({ source: "live" });

  const handleViewerReady = useCallback((viewer: CesiumViewer) => {
    viewerRef.current = viewer;
  }, []);

  const fullReset = useCallback(() => {
    reset();
    setCurrentStep(0);
    setIgnitionPoint(null);
    setActiveFire(null);
    setAppMode("idle");
    setAutoPlay(false);
    setSimKey((k) => k + 1);
  }, [reset]);

  // Convert simulation history to fire frames when simulation completes
  const prevHistoryLen = useRef(0);
  if (appMode === "simulation" && history.length > 0 && history.length !== prevHistoryLen.current && ignitionPoint) {
    prevHistoryLen.current = history.length;
    const fire = convertSimulationToFire(history, activeConfig, ignitionPoint.lat, ignitionPoint.lng);
    setActiveFire(fire);
    setAutoPlay(true);
  }

  const handleIgnite = useCallback(
    async (lat: number, lng: number) => {
      fullReset();
      setAppMode("simulation");
      setIgnitionPoint({ lat, lng });
      setFlyTo({ lat, lng, altitude: 15000, _t: Date.now() });

      // Fetch weather based on selected source
      let weather: WeatherData;
      const ws = weatherSourceRef.current;
      try {
        if (ws.source === "live") {
          weather = await fetchCurrentWeather(lat, lng);
          setWeatherInfo(`Live: ${weather.windSpeed} km/h wind ${weather.windDirection}°, ${weather.humidity}% humidity, ${weather.temperature}°C`);
        } else {
          weather = getSeasonalWeather(lat, ws.season || "summer");
          setWeatherInfo(`${ws.season}: ${weather.windSpeed} km/h wind ${weather.windDirection}°, ${weather.humidity}% humidity`);
        }
      } catch {
        weather = { windSpeed: 20, windDirection: 270, humidity: 30, temperature: 25, source: "fallback" };
        setWeatherInfo("Weather unavailable — using defaults");
      }

      const config: SimulationConfig = {
        ...DEFAULT_CONFIG,
        windSpeed: weather.windSpeed,
        windDirection: weather.windDirection,
        humidity: weather.humidity,
      };
      setActiveConfig(config);

      // Sample vegetation from satellite imagery
      const viewer = viewerRef.current;
      let fuelMap;
      if (viewer && !viewer.isDestroyed()) {
        try {
          fuelMap = sampleVegetation(viewer, lat, lng, config.gridSize, config.cellSizeMeters);
        } catch {
          // Fall back to procedural if sampling fails
        }
      }

      const center = Math.floor(config.gridSize / 2);
      startSimulation(config, center, center, lat, lng, fuelMap);
    },
    [fullReset, startSimulation]
  );

  const handleStart = useCallback((config: SimulationConfig) => {
    setActiveConfig(config);
  }, []);

  const handleWeatherSourceChange = useCallback((source: "live" | "seasonal", season?: Season) => {
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
        onIgnite={appMode !== "idle" ? undefined : handleIgnite}
        flyTo={flyTo}
        onViewerReady={handleViewerReady}
      />

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
        isRunning={isRunning}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        weatherInfo={weatherInfo}
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
        historicalDates={isHistorical ? dateLabels : undefined}
      />

      <Legend
        mode={isHistorical ? "historical" : "simulation"}
        visible={totalSteps > 0}
      />
    </div>
  );
}

export default App;
