import { useState, useCallback, useRef } from "react";
import GlobeView from "./components/GlobeView";
import ControlPanel from "./components/ControlPanel";
import TimelineBar from "./components/TimelineBar";
import FireOverlay from "./components/FireOverlay";
import FireParticles from "./components/FireParticles";
import HistoricalFireOverlay from "./components/HistoricalFireOverlay";
import FireEffects from "./components/FireEffects";
import InfoTooltip from "./components/InfoTooltip";
import Legend from "./components/Legend";
import TimeInfoPanel from "./components/TimeInfoPanel";
import { useSimulation } from "./simulation/useSimulation";
import { DEFAULT_CONFIG, type SimulationConfig } from "./simulation/types";
import { loadHistoricalFire, type HistoricalFire } from "./data/historicalFires";
import type { Viewer as CesiumViewer } from "cesium";

type AppMode = "idle" | "simulation" | "historical";

function App() {
  const { history, isRunning, startSimulation, reset } = useSimulation();
  const [currentStep, setCurrentStep] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>("idle");
  const [ignitionPoint, setIgnitionPoint] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [flyTo, setFlyTo] = useState<{
    lat: number;
    lng: number;
    altitude: number;
    _t: number;
  } | null>(null);
  const [activeConfig, setActiveConfig] =
    useState<SimulationConfig>(DEFAULT_CONFIG);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const [simKey, setSimKey] = useState(0);
  const [historicalFire, setHistoricalFire] = useState<HistoricalFire | null>(null);
  const [tooltip] = useState({
    visible: false,
    x: 0,
    y: 0,
    cellState: "",
    elevation: 0,
    fuel: "",
  });

  const handleViewerReady = useCallback((viewer: CesiumViewer) => {
    viewerRef.current = viewer;
  }, []);

  const clearFireLayers = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    while (viewer.imageryLayers.length > 1) {
      viewer.imageryLayers.remove(viewer.imageryLayers.get(viewer.imageryLayers.length - 1));
    }
  }, []);

  const fullReset = useCallback(() => {
    clearFireLayers();
    reset();
    setCurrentStep(0);
    setIgnitionPoint(null);
    setHistoricalFire(null);
    setAppMode("idle");
    setSimKey((k) => k + 1);
  }, [reset, clearFireLayers]);

  const handleIgnite = useCallback(
    (lat: number, lng: number) => {
      fullReset();
      setAppMode("simulation");
      setIgnitionPoint({ lat, lng });
      setFlyTo({ lat, lng, altitude: 15000, _t: Date.now() });
      const center = Math.floor(activeConfig.gridSize / 2);
      startSimulation(activeConfig, center, center);
    },
    [activeConfig, startSimulation, fullReset]
  );

  const handleStart = useCallback((config: SimulationConfig) => {
    setActiveConfig(config);
  }, []);

  const handleStartHistorical = useCallback(
    async (fireId: string) => {
      fullReset();
      setAppMode("historical");
      const fire = await loadHistoricalFire(fireId);
      setHistoricalFire(fire);
      setFlyTo({ ...fire.location, _t: Date.now() });
      setCurrentStep(0);
    },
    [fullReset]
  );

  const currentState = history[currentStep] ?? null;
  const previousState = history[Math.max(0, currentStep - 5)] ?? null;

  const totalSteps =
    appMode === "historical" && historicalFire
      ? historicalFire.frames.length
      : history.length;

  const historicalDates =
    appMode === "historical" && historicalFire
      ? historicalFire.frames.map((f) => f.date)
      : undefined;

  return (
    <div className="h-screen w-screen relative">
      <GlobeView
        onIgnite={appMode !== "idle" ? undefined : handleIgnite}
        flyTo={flyTo}
        onViewerReady={handleViewerReady}
      />

      {/* Simulation fire overlay */}
      {appMode === "simulation" && ignitionPoint && (
        <>
          <FireOverlay
            key={`overlay-${simKey}`}
            state={currentState}
            previousState={previousState}
            config={activeConfig}
            centerLat={ignitionPoint.lat}
            centerLng={ignitionPoint.lng}
            viewer={viewerRef.current}
          />
          <FireParticles
            key={`particles-${simKey}`}
            state={currentState}
            config={activeConfig}
            centerLat={ignitionPoint.lat}
            centerLng={ignitionPoint.lng}
            viewer={viewerRef.current}
          />
        </>
      )}

      {/* Historical fire overlay */}
      {appMode === "historical" && historicalFire && (
        <>
          <HistoricalFireOverlay
            key={`historical-${simKey}`}
            fire={historicalFire}
            currentFrame={currentStep}
            viewer={viewerRef.current}
          />
          <FireEffects
            key={`effects-${simKey}-${currentStep}`}
            activePositions={
              historicalFire.frames[currentStep]?.hotspots.map((h) => ({
                lat: h.lat,
                lng: h.lng,
              })) ?? []
            }
            viewer={viewerRef.current}
          />
        </>
      )}

      <ControlPanel
        onStart={handleStart}
        onStartHistorical={handleStartHistorical}
        onReset={fullReset}
        isRunning={isRunning}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />

      <TimelineBar
        totalSteps={totalSteps}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        timestepMinutes={activeConfig.timestepMinutes}
        dateLabels={historicalDates}
      />

      <TimeInfoPanel
        currentStep={currentStep}
        timestepMinutes={activeConfig.timestepMinutes}
        visible={totalSteps > 0}
        historicalDates={historicalDates}
      />

      <Legend
        mode={appMode === "historical" ? "historical" : "simulation"}
        visible={totalSteps > 0}
      />

      <InfoTooltip {...tooltip} />
    </div>
  );
}

export default App;
