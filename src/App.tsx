import { useState, useCallback, useRef } from "react";
import GlobeView from "./components/GlobeView";
import ControlPanel from "./components/ControlPanel";
import TimelineBar from "./components/TimelineBar";
import FireOverlay from "./components/FireOverlay";
import FireParticles from "./components/FireParticles";
import InfoTooltip from "./components/InfoTooltip";
import TimeInfoPanel from "./components/TimeInfoPanel";
import { useSimulation } from "./simulation/useSimulation";
import { DEFAULT_CONFIG, type SimulationConfig } from "./simulation/types";
import type { Scenario } from "./scenarios";
import type { Viewer as CesiumViewer } from "cesium";

function App() {
  const { history, isRunning, startSimulation, reset } = useSimulation();
  const [currentStep, setCurrentStep] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [ignitionPoint, setIgnitionPoint] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [flyTo, setFlyTo] = useState<{
    lat: number;
    lng: number;
    altitude: number;
  } | null>(null);
  const [activeConfig, setActiveConfig] =
    useState<SimulationConfig>(DEFAULT_CONFIG);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const [simKey, setSimKey] = useState(0);
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

  // Remove all fire overlay imagery layers from the viewer
  const clearFireLayers = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    // Remove all imagery layers except the base layer (index 0)
    while (viewer.imageryLayers.length > 1) {
      viewer.imageryLayers.remove(viewer.imageryLayers.get(viewer.imageryLayers.length - 1));
    }
  }, []);

  const handleIgnite = useCallback(
    (lat: number, lng: number) => {
      clearFireLayers();
      reset();
      setCurrentStep(0);
      setSimKey((k) => k + 1);
      setIgnitionPoint({ lat, lng });
      setFlyTo({ lat, lng, altitude: 15000 });
      const center = Math.floor(activeConfig.gridSize / 2);
      startSimulation(activeConfig, center, center);
    },
    [activeConfig, startSimulation, reset, clearFireLayers]
  );

  const handleStart = useCallback((config: SimulationConfig) => {
    setActiveConfig(config);
  }, []);

  const handleStartScenario = useCallback(
    (scenario: Scenario) => {
      clearFireLayers();
      reset();
      setCurrentStep(0);
      setSimKey((k) => k + 1);
      setIgnitionPoint({
        lat: scenario.location.lat,
        lng: scenario.location.lng,
      });
      setFlyTo({ ...scenario.location });
      setActiveConfig(scenario.config);
      startSimulation(
        scenario.config,
        scenario.igniteOffset.row,
        scenario.igniteOffset.col
      );
    },
    [startSimulation, reset, clearFireLayers]
  );

  const handleReset = useCallback(() => {
    clearFireLayers();
    reset();
    setCurrentStep(0);
    setIgnitionPoint(null);
    setSimKey((k) => k + 1);
  }, [reset, clearFireLayers]);

  const currentState = history[currentStep] ?? null;
  const previousState = history[Math.max(0, currentStep - 5)] ?? null;

  return (
    <div className="h-screen w-screen relative">
      <GlobeView onIgnite={handleIgnite} flyTo={flyTo} onViewerReady={handleViewerReady} />

      {ignitionPoint && (
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

      <ControlPanel
        onStart={handleStart}
        onStartScenario={handleStartScenario}
        onReset={handleReset}
        isRunning={isRunning}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />

      <TimelineBar
        totalSteps={history.length}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        timestepMinutes={activeConfig.timestepMinutes}
      />

      <TimeInfoPanel
        currentStep={currentStep}
        timestepMinutes={activeConfig.timestepMinutes}
        visible={history.length > 0}
      />

      <InfoTooltip {...tooltip} />
    </div>
  );
}

export default App;
