import { useState, useCallback } from "react";
import GlobeView from "./components/GlobeView";
import ControlPanel from "./components/ControlPanel";
import TimelineBar from "./components/TimelineBar";
import FireOverlay from "./components/FireOverlay";
import FireParticles from "./components/FireParticles";
import InfoTooltip from "./components/InfoTooltip";
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
  const [viewer, setViewer] = useState<CesiumViewer | null>(null);
  const [tooltip, setTooltip] = useState({
    visible: false,
    x: 0,
    y: 0,
    cellState: "",
    elevation: 0,
    fuel: "",
  });

  const handleIgnite = useCallback(
    (lat: number, lng: number) => {
      setIgnitionPoint({ lat, lng });
      const center = Math.floor(activeConfig.gridSize / 2);
      startSimulation(activeConfig, center, center);
      setCurrentStep(0);
    },
    [activeConfig, startSimulation]
  );

  const handleStart = useCallback((config: SimulationConfig) => {
    setActiveConfig(config);
    // In ignite mode, config is saved for when the user clicks the globe
  }, []);

  const handleStartScenario = useCallback(
    (scenario: Scenario) => {
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
      setCurrentStep(0);
    },
    [startSimulation]
  );

  const handleReset = useCallback(() => {
    reset();
    setCurrentStep(0);
    setIgnitionPoint(null);
  }, [reset]);

  const currentState = history[currentStep] ?? null;

  return (
    <div className="h-screen w-screen relative">
      <GlobeView onIgnite={handleIgnite} flyTo={flyTo} onViewerReady={setViewer}>
        {ignitionPoint && (
          <FireParticles
            state={currentState}
            config={activeConfig}
            centerLat={ignitionPoint.lat}
            centerLng={ignitionPoint.lng}
          />
        )}
      </GlobeView>

      {ignitionPoint && (
        <FireOverlay
          state={currentState}
          config={activeConfig}
          centerLat={ignitionPoint.lat}
          centerLng={ignitionPoint.lng}
          viewer={viewer}
        />
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

      <InfoTooltip {...tooltip} />
    </div>
  );
}

export default App;
