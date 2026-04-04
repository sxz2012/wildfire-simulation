import { useState, useCallback, useRef, useEffect } from "react";
import GlobeView from "./components/GlobeView";
import ControlPanel from "./components/ControlPanel";
import TimelineBar from "./components/TimelineBar";
import HistoricalFireOverlay from "./components/HistoricalFireOverlay";
import FireEffects from "./components/FireEffects";
import Legend from "./components/Legend";
import TimeInfoPanel from "./components/TimeInfoPanel";
import { useSimulation } from "./simulation/useSimulation";
import { convertSimulationToFire } from "./simulation/convertToFrames";
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

  // Unified fire data — used for both historical and simulation
  const [activeFire, setActiveFire] = useState<HistoricalFire | null>(null);

  const handleViewerReady = useCallback((viewer: CesiumViewer) => {
    viewerRef.current = viewer;
  }, []);

  const fullReset = useCallback(() => {
    reset();
    setCurrentStep(0);
    setIgnitionPoint(null);
    setActiveFire(null);
    setAppMode("idle");
    setSimKey((k) => k + 1);
  }, [reset]);

  // Convert simulation history to fire frames when simulation completes
  useEffect(() => {
    if (appMode === "simulation" && history.length > 0 && ignitionPoint) {
      const fire = convertSimulationToFire(
        history,
        activeConfig,
        ignitionPoint.lat,
        ignitionPoint.lng
      );
      setActiveFire(fire);
    }
  }, [history, appMode, activeConfig, ignitionPoint]);

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
      setActiveFire(fire);
      setFlyTo({ ...fire.location, _t: Date.now() });
      setCurrentStep(0);
    },
    [fullReset]
  );

  const totalSteps = activeFire ? activeFire.frames.length : 0;

  const dateLabels = activeFire
    ? activeFire.frames.map((f) => f.date)
    : undefined;

  // For simulation mode, dateLabels are like "Day 1, 00:00" — use them directly in timeline
  const isHistorical = appMode === "historical";

  return (
    <div className="h-screen w-screen relative">
      <GlobeView
        onIgnite={appMode !== "idle" ? undefined : handleIgnite}
        flyTo={flyTo}
        onViewerReady={handleViewerReady}
      />

      {/* Unified fire overlay for both modes */}
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
              activeFire.frames[currentStep]?.hotspots.map((h) => ({
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
        dateLabels={dateLabels}
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
