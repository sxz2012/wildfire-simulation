import { useState } from "react";
import { DEFAULT_CONFIG, type SimulationConfig } from "../simulation/types";
import { HISTORICAL_FIRE_LIST, type HistoricalFire } from "../data/historicalFires";
import { SEASONS, type Season } from "../services/weather";
import ImpactSection from "./ImpactSection";
import LocationSearch from "./LocationSearch";
import ScenarioPicker, { type ScenarioSummary } from "./ScenarioPicker";
import SuppressionInputs from "./SuppressionInputs";
import type { ResourceCount, SimulationState, SuppressionStepDiag } from "../simulation/types";

type WeatherSource = "live" | "seasonal" | "custom";

interface ControlPanelProps {
  onStart: (config: SimulationConfig) => void;
  onStartHistorical: (fireId: string) => void;
  onReset: () => void;
  onWeatherSourceChange: (source: WeatherSource, season?: Season) => void;
  /** Fly the camera to a search-selected location. */
  onLocationSelected?: (lat: number, lng: number, label: string) => void;
  onScenarioPick?: (scenario: ScenarioSummary) => void;
  onScenarioLive?: () => void;
  isRunning: boolean;
  /** True when the user has dropped a flame pin and is ready to start. */
  hasPendingIgnition?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  weatherInfo?: string;
  fire?: HistoricalFire | null;
  currentFrame?: number;
  showImpact?: boolean;
  suppressionDelay?: number;
  suppressionResources?: ResourceCount[];
  onSuppressionChange?: (delay: number, resources: ResourceCount[]) => void;
  suppressionDiags?: SuppressionStepDiag[];
  baselineHistory?: SimulationState[];
  suppressedHistory?: SimulationState[];
  analysis?: {
    q1?: { bundle: string; maxDelayMin: number | null };
    q2?: { delayMin: number; minTier: string | null };
  };
  thresholdAreaHa?: number;
  nearbyResources?: { stationCount: number; radiusKm: number; suggestedBundle: string };
  /** Externally-controlled value for the Location search input. */
  locationDisplay?: string;
}

export default function ControlPanel({
  onStart,
  onStartHistorical,
  onReset,
  onWeatherSourceChange,
  onLocationSelected,
  onScenarioPick,
  onScenarioLive,
  isRunning,
  hasPendingIgnition = false,
  collapsed,
  onToggleCollapse,
  weatherInfo,
  fire,
  currentFrame,
  showImpact,
  suppressionDelay,
  suppressionResources,
  onSuppressionChange,
  suppressionDiags,
  baselineHistory,
  suppressedHistory,
  analysis,
  thresholdAreaHa,
  nearbyResources,
  locationDisplay,
}: ControlPanelProps) {
  const [config, setConfig] = useState<SimulationConfig>({ ...DEFAULT_CONFIG });
  const [mode, setMode] = useState<"ignite" | "historical">("historical");
  const [selectedFire, setSelectedFire] = useState(0);
  const [weatherSource, setWeatherSource] = useState<WeatherSource>("live");
  const [selectedSeason, setSelectedSeason] = useState<Season>("summer");

  const update = (partial: Partial<SimulationConfig>) =>
    setConfig((prev) => ({ ...prev, ...partial }));

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="fire-panel absolute top-4 left-4 z-50 text-amber-400 px-3 py-2.5 rounded-lg
          hover:border-amber-400/40 transition-all duration-200 group cursor-pointer"
      >
        <span className="flex items-center gap-2 text-base font-medium tracking-wide">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 7l5 5-5 5M6 12h12"/>
          </svg>
          PANEL
        </span>
      </button>
    );
  }

  return (
    <div className="fire-panel animate-enter-left absolute top-3 left-3 z-50 w-80 rounded-xl text-white flex flex-col max-h-[calc(100vh-80px)] overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-amber-500/10">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse" />
            <h2 className="text-base font-bold tracking-[0.15em] uppercase"
              style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--fire-amber)" }}>
              Wildfire Ops
            </h2>
          </div>
          <button onClick={onToggleCollapse}
            className="text-gray-500 hover:text-amber-400 transition-colors p-1 cursor-pointer">
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
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-md text-sm font-semibold tracking-wide uppercase transition-all duration-200 cursor-pointer ${
                mode === m ? "bg-amber-500/20 text-amber-400" : "text-gray-500 hover:text-gray-300"
              }`}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {m === "historical" ? "Historical" : "Simulate"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {mode === "ignite" && (
          <>
            {onScenarioPick && onScenarioLive && (
              <ScenarioPicker
                onPick={onScenarioPick}
                onLive={onScenarioLive}
              />
            )}

            {onLocationSelected && (
              <div>
                <SectionLabel>Location</SectionLabel>
                <LocationSearch onSelect={onLocationSelected} displayValue={locationDisplay} />
              </div>
            )}

            <div>
              <SectionLabel>Weather Source</SectionLabel>
              <div className="flex bg-white/5 rounded-lg p-0.5 mb-3">
                {(["live", "seasonal", "custom"] as const).map((ws) => (
                  <button key={ws}
                    onClick={() => {
                      setWeatherSource(ws);
                      onWeatherSourceChange(ws, ws === "seasonal" ? selectedSeason : undefined);
                    }}
                    className={`flex-1 py-1.5 rounded-md text-label font-semibold tracking-wide uppercase transition-all duration-200 cursor-pointer ${
                      weatherSource === ws ? "bg-amber-500/15 text-amber-400" : "text-gray-500 hover:text-gray-300"
                    }`}
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    {ws === "live" ? "Live" : ws === "seasonal" ? "Seasonal" : "Custom"}
                  </button>
                ))}
              </div>

              {weatherSource === "seasonal" && (
                <select value={selectedSeason}
                  onChange={(e) => {
                    const s = e.target.value as Season;
                    setSelectedSeason(s);
                    onWeatherSourceChange("seasonal", s);
                  }}
                  className="fire-select w-full mb-2">
                  {SEASONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              )}

              {weatherSource !== "custom" && weatherInfo && (
                <div className="bg-white/[0.03] rounded-lg px-3 py-2.5 border border-white/[0.04]">
                  <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{weatherInfo}</p>
                </div>
              )}

              {weatherSource === "custom" && (
                <div className="flex flex-col gap-3">
                  <SliderField label="Wind Speed" value={config.windSpeed} unit="km/h" min={0} max={60}
                    onChange={(v) => update({ windSpeed: v })} />
                  <SliderField label="Wind Direction" value={config.windDirection} unit="°" min={0} max={360}
                    onChange={(v) => update({ windDirection: v })} />
                  <SliderField label="Humidity" value={config.humidity} unit="%" min={0} max={100}
                    onChange={(v) => update({ humidity: v })} />
                </div>
              )}
            </div>

            {onSuppressionChange && suppressionResources !== undefined && suppressionDelay !== undefined && (
              <SuppressionInputs
                responseDelayMin={suppressionDelay}
                resources={suppressionResources}
                onChange={onSuppressionChange}
                nearbyResources={nearbyResources}
              />
            )}

            <p className="text-sm text-gray-500 leading-relaxed">
              {weatherSource === "live"
                ? "Click on the globe to ignite. Live weather will be fetched for that location."
                : weatherSource === "seasonal"
                ? "Click on the globe to ignite. Typical seasonal conditions will be applied."
                : "Click on the globe to ignite with your custom weather parameters."}
            </p>
          </>
        )}

        {mode === "historical" && (
          <>
            <div>
              <SectionLabel>Select Fire Event</SectionLabel>
              <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto pr-1">
                {HISTORICAL_FIRE_LIST.map((f, i) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setSelectedFire(i);
                      onStartHistorical(f.id);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-all duration-200 cursor-pointer ${
                      selectedFire === i
                        ? "bg-amber-500/15 border-amber-500/30"
                        : "bg-white/[0.03] border-white/[0.04] hover:border-amber-500/20 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-baseline justify-between mb-0.5">
                      <span className="text-sm font-semibold text-gray-200 truncate">
                        {f.name.replace(/ \(.*\)$/, "").replace(/ \d{4}$/, "")}
                      </span>
                      <span
                        className="text-caption text-gray-500 ml-2 flex-shrink-0"
                        style={{ fontFamily: "'JetBrains Mono', monospace" }}
                      >
                        {f.year}
                      </span>
                    </div>
                    <div className="text-micro text-gray-500 mb-1">{f.location}</div>
                    <div className="flex flex-wrap gap-1">
                      {f.acres && <Pill label={formatAcres(f.acres)} />}
                      {f.damage && <Pill label={f.damage} />}
                      {f.fatalities && <Pill label={`${f.fatalities} deaths`} color="red" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 text-caption text-gray-500">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                NASA FIRMS VIIRS/MODIS Satellite Data
              </span>
            </div>
          </>
        )}

        {showImpact && fire && (
          <div className="border-t border-white/[0.04] pt-4 mt-2">
            <ImpactSection
              fire={fire}
              currentFrame={currentFrame ?? 0}
              suppressionDiags={suppressionDiags}
              baselineHistory={baselineHistory}
              suppressedHistory={suppressedHistory}
              analysis={analysis}
              thresholdAreaHa={thresholdAreaHa}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 pb-4 pt-2 border-t border-white/[0.04] flex gap-2">
        {mode === "ignite" ? (
          <button
            onClick={() => onStart(config)}
            disabled={isRunning || !hasPendingIgnition}
            className={`flex-1 border py-2.5 rounded-lg font-semibold text-base transition-all duration-200 ${
              hasPendingIgnition && !isRunning
                ? "bg-amber-500/30 hover:bg-amber-500/40 border-amber-500/60 hover:border-amber-500/80 text-amber-300 cursor-pointer shadow-[0_0_12px_rgba(245,158,11,0.25)]"
                : "bg-amber-500/10 border-amber-500/20 text-amber-400/60 cursor-default"
            }`}
          >
            {isRunning
              ? "Simulating..."
              : hasPendingIgnition
                ? "Start the Wildfire"
                : "Click Globe to Ignite"}
          </button>
        ) : (
          <button onClick={() => onStartHistorical(HISTORICAL_FIRE_LIST[selectedFire].id)} disabled={isRunning}
            className="flex-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 hover:border-amber-500/50
              disabled:opacity-40 py-2.5 rounded-lg font-semibold text-base text-amber-400 transition-all duration-200 cursor-pointer">
            {isRunning ? "Loading..." : "Replay Fire"}
          </button>
        )}
        <button onClick={onReset}
          className="px-4 py-2.5 rounded-lg text-base text-gray-400 hover:text-white bg-white/5 hover:bg-white/10
            border border-white/[0.06] hover:border-white/10 transition-all duration-200 cursor-pointer">
          Reset
        </button>
      </div>
    </div>
  );
}

function Pill({ label, color }: { label: string; color?: "red" | "default" }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-micro font-medium ${
        color === "red"
          ? "bg-red-500/15 text-red-400 border border-red-500/20"
          : "bg-white/[0.06] text-gray-400 border border-white/[0.06]"
      }`}
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
    >
      {label}
    </span>
  );
}

function formatAcres(acres: number): string {
  if (acres >= 1_000_000) return (acres / 1_000_000).toFixed(1) + "M acres";
  if (acres >= 1_000) return Math.round(acres / 1_000) + "K acres";
  return acres + " acres";
}

function SectionLabel({ children }: { children: string }) {
  return (
    <label className="block text-sm font-medium tracking-wider uppercase mb-1.5"
      style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-secondary)" }}>
      {children}
    </label>
  );
}

function SliderField({ label, value, unit, min, max, onChange }: {
  label: string; value: number; unit: string; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <label className="text-caption font-medium tracking-wider uppercase"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-secondary)" }}>
          {label}
        </label>
        <span className="text-sm font-semibold tabular-nums"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--fire-amber)" }}>
          {value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="fire-slider w-full" />
    </div>
  );
}
