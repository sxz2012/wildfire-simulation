import { useState } from "react";
import { FuelType, DEFAULT_CONFIG, type SimulationConfig } from "../simulation/types";
import { HISTORICAL_FIRE_LIST } from "../data/historicalFires";

interface ControlPanelProps {
  onStart: (config: SimulationConfig) => void;
  onStartHistorical: (fireId: string) => void;
  onReset: () => void;
  isRunning: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function ControlPanel({
  onStart,
  onStartHistorical,
  onReset,
  isRunning,
  collapsed,
  onToggleCollapse,
}: ControlPanelProps) {
  const [config, setConfig] = useState<SimulationConfig>({ ...DEFAULT_CONFIG });
  const [mode, setMode] = useState<"ignite" | "historical">("historical");
  const [selectedFire, setSelectedFire] = useState(0);

  const update = (partial: Partial<SimulationConfig>) =>
    setConfig((prev) => ({ ...prev, ...partial }));

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="absolute top-4 left-4 z-50 bg-gray-900/90 text-white px-3 py-2 rounded-lg hover:bg-gray-800 backdrop-blur"
      >
        Controls &rsaquo;
      </button>
    );
  }

  return (
    <div className="absolute top-0 left-0 z-50 h-full w-80 bg-gray-900/90 backdrop-blur text-white p-4 flex flex-col gap-4 overflow-y-auto">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">Wildfire Simulator</h2>
        <button onClick={onToggleCollapse} className="text-gray-400 hover:text-white">
          &lsaquo;
        </button>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode("historical")}
          className={`flex-1 py-1.5 rounded text-sm ${
            mode === "historical" ? "bg-orange-600" : "bg-gray-700 hover:bg-gray-600"
          }`}
        >
          Historical Fires
        </button>
        <button
          onClick={() => setMode("ignite")}
          className={`flex-1 py-1.5 rounded text-sm ${
            mode === "ignite" ? "bg-orange-600" : "bg-gray-700 hover:bg-gray-600"
          }`}
        >
          Simulate
        </button>
      </div>

      {mode === "ignite" && (
        <>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-300">
                Wind Speed: {config.windSpeed} km/h
              </span>
              <input
                type="range" min={0} max={60}
                value={config.windSpeed}
                onChange={(e) => update({ windSpeed: Number(e.target.value) })}
                className="accent-orange-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-300">
                Wind Direction: {config.windDirection}&deg;
              </span>
              <input
                type="range" min={0} max={360}
                value={config.windDirection}
                onChange={(e) => update({ windDirection: Number(e.target.value) })}
                className="accent-orange-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-300">
                Humidity: {config.humidity}%
              </span>
              <input
                type="range" min={0} max={100}
                value={config.humidity}
                onChange={(e) => update({ humidity: Number(e.target.value) })}
                className="accent-orange-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-300">Vegetation</span>
              <select
                value={config.defaultFuel}
                onChange={(e) => update({ defaultFuel: e.target.value as FuelType })}
                className="bg-gray-700 rounded px-2 py-1 text-sm"
              >
                <option value={FuelType.Grass}>Grass</option>
                <option value={FuelType.Shrub}>Shrub</option>
                <option value={FuelType.Forest}>Forest</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2 mt-auto">
            <button
              onClick={() => onStart(config)}
              disabled={isRunning}
              className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 py-2 rounded font-medium"
            >
              {isRunning ? "Running..." : "Start"}
            </button>
            <button onClick={onReset} className="flex-1 bg-gray-700 hover:bg-gray-600 py-2 rounded font-medium">
              Reset
            </button>
          </div>
        </>
      )}

      {mode === "historical" && (
        <>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-300">Choose a historical fire</span>
              <select
                value={selectedFire}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setSelectedFire(idx);
                  onStartHistorical(HISTORICAL_FIRE_LIST[idx].id);
                }}
                className="bg-gray-700 rounded px-2 py-1 text-sm"
              >
                {HISTORICAL_FIRE_LIST.map((f, i) => (
                  <option key={i} value={i}>{f.name}</option>
                ))}
              </select>
            </label>
            <p className="text-sm text-gray-400 leading-relaxed">
              {HISTORICAL_FIRE_LIST[selectedFire].description}
            </p>
            <p className="text-xs text-gray-500">
              Data: NASA FIRMS satellite fire detections
            </p>
          </div>
          <div className="flex gap-2 mt-auto">
            <button
              onClick={() => onStartHistorical(HISTORICAL_FIRE_LIST[selectedFire].id)}
              disabled={isRunning}
              className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 py-2 rounded font-medium"
            >
              {isRunning ? "Loading..." : "Replay Fire"}
            </button>
            <button onClick={onReset} className="flex-1 bg-gray-700 hover:bg-gray-600 py-2 rounded font-medium">
              Reset
            </button>
          </div>
        </>
      )}
    </div>
  );
}
