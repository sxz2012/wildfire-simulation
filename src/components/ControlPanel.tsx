import { useState } from "react";
import { DEFAULT_CONFIG, type SimulationConfig } from "../simulation/types";
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
        className="fire-panel absolute top-4 left-4 z-50 text-amber-400 px-3 py-2.5 rounded-lg
          hover:border-amber-400/40 transition-all duration-200 group cursor-pointer"
      >
        <span className="flex items-center gap-2 text-sm font-medium tracking-wide">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" opacity="0.3"/>
            <path d="M13 7l5 5-5 5M6 12h12"/>
          </svg>
          PANEL
        </span>
      </button>
    );
  }

  return (
    <div className="fire-panel absolute top-3 left-3 z-50 w-80 rounded-xl text-white flex flex-col max-h-[calc(100vh-80px)] overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-amber-500/10">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse" />
            <h2
              className="text-sm font-bold tracking-[0.15em] uppercase"
              style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--fire-amber)" }}
            >
              Wildfire Ops
            </h2>
          </div>
          <button
            onClick={onToggleCollapse}
            className="text-gray-500 hover:text-amber-400 transition-colors p-1 cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="px-5 pt-4">
        <div className="flex bg-white/5 rounded-lg p-0.5">
          {(["historical", "ignite"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-md text-xs font-semibold tracking-wide uppercase transition-all duration-200 cursor-pointer ${
                mode === m
                  ? "bg-amber-500/20 text-amber-400 shadow-[inset_0_0_12px_rgba(245,158,11,0.1)]"
                  : "text-gray-500 hover:text-gray-300"
              }`}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {m === "historical" ? "Historical" : "Simulate"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {mode === "ignite" && (
          <>
            <div className="flex flex-col gap-4">
              <SliderField
                label="Wind Speed"
                value={config.windSpeed}
                unit="km/h"
                min={0} max={60}
                onChange={(v) => update({ windSpeed: v })}
              />
              <SliderField
                label="Wind Direction"
                value={config.windDirection}
                unit="°"
                min={0} max={360}
                onChange={(v) => update({ windDirection: v })}
              />
              <SliderField
                label="Humidity"
                value={config.humidity}
                unit="%"
                min={0} max={100}
                onChange={(v) => update({ humidity: v })}
              />
            </div>

            <p className="text-[11px] text-gray-500 leading-relaxed">
              Click anywhere on the globe to ignite. Vegetation is auto-assigned based on terrain. Fire model calibrated against NASA FIRMS data.
            </p>
          </>
        )}

        {mode === "historical" && (
          <>
            <div>
              <label
                className="block text-[11px] font-medium tracking-wider uppercase mb-1.5"
                style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-secondary)" }}
              >
                Select Fire Event
              </label>
              <select
                value={selectedFire}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setSelectedFire(idx);
                  onStartHistorical(HISTORICAL_FIRE_LIST[idx].id);
                }}
                className="fire-select w-full"
              >
                {HISTORICAL_FIRE_LIST.map((f, i) => (
                  <option key={i} value={i}>{f.name}</option>
                ))}
              </select>
            </div>

            <div className="bg-white/[0.03] rounded-lg px-3.5 py-3 border border-white/[0.04] space-y-2">
              <p className="text-[13px] text-gray-300 leading-relaxed">
                {HISTORICAL_FIRE_LIST[selectedFire].description}
              </p>
              {"details" in HISTORICAL_FIRE_LIST[selectedFire] && (
                <p className="text-[11px] text-gray-500 leading-relaxed border-t border-white/[0.04] pt-2">
                  {(HISTORICAL_FIRE_LIST[selectedFire] as { details: string }).details}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                NASA FIRMS VIIRS/MODIS Satellite Data
              </span>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 pb-4 pt-2 border-t border-white/[0.04] flex gap-2">
        {mode === "ignite" ? (
          <button
            onClick={() => onStart(config)}
            disabled={isRunning}
            className="flex-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 hover:border-amber-500/50
              disabled:opacity-40 disabled:hover:bg-amber-500/20 py-2.5 rounded-lg font-semibold text-sm
              text-amber-400 transition-all duration-200 cursor-pointer"
          >
            {isRunning ? "Simulating..." : "Start Simulation"}
          </button>
        ) : (
          <button
            onClick={() => onStartHistorical(HISTORICAL_FIRE_LIST[selectedFire].id)}
            disabled={isRunning}
            className="flex-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 hover:border-amber-500/50
              disabled:opacity-40 disabled:hover:bg-amber-500/20 py-2.5 rounded-lg font-semibold text-sm
              text-amber-400 transition-all duration-200 cursor-pointer"
          >
            {isRunning ? "Loading..." : "Replay Fire"}
          </button>
        )}
        <button
          onClick={onReset}
          className="px-4 py-2.5 rounded-lg text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-white/10
            border border-white/[0.06] hover:border-white/10 transition-all duration-200 cursor-pointer"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/* ─── Slider Field Sub-component ─── */
function SliderField({
  label, value, unit, min, max, onChange
}: {
  label: string; value: number; unit: string; min: number; max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <label
          className="text-[11px] font-medium tracking-wider uppercase"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-secondary)" }}
        >
          {label}
        </label>
        <span
          className="text-[13px] font-semibold tabular-nums"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--fire-amber)" }}
        >
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="fire-slider w-full"
      />
    </div>
  );
}
