import { useState } from "react";
import type { ReactElement } from "react";
import { useModelConfig, DEFAULT_MODEL_CONFIG } from "../contexts/ModelConfig";

interface ModelDetailsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const MONO_FONT = { fontFamily: "'JetBrains Mono', monospace" } as const;

type TabKey = "overview" | "params" | "references";

export default function ModelDetailsPanel({
  isOpen,
  onClose,
}: ModelDetailsPanelProps): ReactElement {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const { config, setConfig, resetAll, isModified } = useModelConfig();

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`fire-panel fixed top-0 h-screen w-[360px] z-40 flex flex-col transition-[right] duration-300 ease-out shadow-[-12px_0_32px_-8px_rgba(0,0,0,0.6)] ${
        isOpen ? "" : "pointer-events-none"
      }`}
      style={{ right: isOpen ? 0 : -360 }}
    >
      {/* Left accent bar — signals the panel as a methodology context. */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-amber-500/40 via-amber-500/10 to-transparent" />

      <div
        className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]"
        style={MONO_FONT}
      >
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
          <span className="text-sm tracking-[0.2em] uppercase text-amber-400 font-semibold">
            Model Details
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-amber-200 text-xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-white/[0.04] transition-colors"
          aria-label="Close model details"
        >
          ×
        </button>
      </div>

      <div className="flex border-b border-white/[0.06]" style={MONO_FONT}>
        {(
          [
            ["overview", "Overview"],
            ["params", "Params"],
            ["references", "Refs"],
          ] as Array<[TabKey, string]>
        ).map(([key, label]) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 py-2.5 text-caption tracking-[0.18em] uppercase transition-colors ${
                active
                  ? "text-amber-400 border-b-2 border-amber-400"
                  : "text-gray-500 border-b-2 border-transparent hover:text-gray-200"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="overflow-y-auto flex-1 px-4 py-3">
        {activeTab === "overview" && (
          <OverviewTab onJumpToParams={() => setActiveTab("params")} />
        )}
        {activeTab === "params" && (
          <ParametersTab
            config={config}
            setConfig={setConfig}
            resetAll={resetAll}
            isModified={isModified}
          />
        )}
        {activeTab === "references" && <ReferencesTab />}
      </div>
    </div>
  );
}

function OverviewTab({ onJumpToParams }: { onJumpToParams: () => void }): ReactElement {
  return (
    <div className="space-y-5 text-sm text-gray-300 leading-relaxed">
      <section>
        <h3
          className="text-label uppercase tracking-[0.15em] text-amber-400 mb-2"
          style={MONO_FONT}
        >
          Fire Spread Model
        </h3>
        <p className="mb-2">
          The simulation tracks each cell of a 600×600 grid (50 m per cell). Fire spreads
          from a Burning cell to its 8 neighbors based on a simplified Rothermel
          rate-of-spread equation: R = R₀ × (1 + φ_wind + φ_slope) × humidity_factor,
          where R₀ is the base rate for the fuel type (grass, shrub, forest).
        </p>
        <p className="mb-2">
          A pre-trained ML model (XGBoost on historical fire perimeters) refines the
          spread probability per cell using terrain, fuel moisture, and wind. Real
          elevation comes from Cesium World Terrain; vegetation from ESA WorldCover (10 m
          resolution).
        </p>
        <p className="mb-2">
          A cell that's been Burning for its fuel-specific duration transitions to
          Burned. Suppressed cells stop spreading immediately — that's how containment
          lines stop the fire.
        </p>
        <button
          onClick={onJumpToParams}
          className="text-amber-400 hover:text-amber-300 text-micro"
          style={MONO_FONT}
        >
          [See parameters]
        </button>
      </section>

      <section>
        <h3
          className="text-label uppercase tracking-[0.15em] text-amber-400 mb-2"
          style={MONO_FONT}
        >
          Suppression Model
        </h3>
        <p className="mb-2">
          Resources build fireline at NWCG-published rates (chains/hr per dozer, crew,
          engine). Aerial resources (helitack, air tanker) reduce the spread rate inside
          their drop swath rather than building line directly.
        </p>
        <p className="mb-2">
          The total chains/hr capacity is multiplied by a Hirsch–Martell delay decay —
          every additional minute crews wait reduces effective capacity (modeled response
          delay vs operational productivity). The Reed–McCool model then estimates
          containment probability from cumulative line built / active fire perimeter.
        </p>
        <p className="mb-2">
          Each timestep, the model picks N cells along the active perimeter (proportional
          to capacity-after-decay) and marks them Suppressed.
        </p>
        <button
          onClick={onJumpToParams}
          className="text-amber-400 hover:text-amber-300 text-micro"
          style={MONO_FONT}
        >
          [See parameters]
        </button>
      </section>

      <section>
        <h3
          className="text-label uppercase tracking-[0.15em] text-amber-400 mb-2"
          style={MONO_FONT}
        >
          Inverse Search
        </h3>
        <p className="mb-2">
          Given a paused fire and a user-drawn polygon, find the smallest resource roster
          that keeps the fire inside. Strategy: bisection on total chains/hr capacity in
          [0, search ceiling]. For each candidate, build the cheapest mix (greedy by
          $/chain), run a 30-step simulation from the paused state, check if any Burning
          cell is outside the polygon (with breach tolerance %).
        </p>
        <p className="mb-2">
          Bisection converges in ≤ 8 sim runs. Output is a custom roster (e.g.{" "}
          <em>3 dozers · 2 crews · 1 helitack</em>) plus a realism-tier badge (Initial
          Attack / Type 2-3 / Type 1 / Multi-jurisdictional surge).
        </p>
        <button
          onClick={onJumpToParams}
          className="text-amber-400 hover:text-amber-300 text-micro"
          style={MONO_FONT}
        >
          [See parameters]
        </button>
      </section>
    </div>
  );
}

interface SliderRowProps {
  label: string;
  tooltip: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  units: string;
  onChange: (v: number) => void;
  onReset: () => void;
}

function SliderRow({
  label,
  tooltip,
  value,
  defaultValue,
  min,
  max,
  step,
  units,
  onChange,
  onReset,
}: SliderRowProps): ReactElement {
  const modified = value !== defaultValue;
  return (
    <label className="block mb-3">
      <div className="flex items-baseline justify-between mb-1">
        <span title={tooltip} className="text-sm text-gray-200" style={MONO_FONT}>
          {label}
        </span>
        <div className="flex items-baseline gap-2">
          <span className="text-amber-400 tabular-nums text-sm" style={MONO_FONT}>
            {value} {units}
          </span>
          {modified && (
            <span className="text-amber-400/70 text-micro" style={MONO_FONT}>
              (modified)
            </span>
          )}
          <button
            onClick={onReset}
            title="Reset"
            className="text-gray-400 hover:text-amber-400 text-sm leading-none"
          >
            ↺
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-500"
      />
    </label>
  );
}

interface ParametersTabProps {
  config: ReturnType<typeof useModelConfig>["config"];
  setConfig: ReturnType<typeof useModelConfig>["setConfig"];
  resetAll: () => void;
  isModified: boolean;
}

function ParametersTab({
  config,
  setConfig,
  resetAll,
  isModified,
}: ParametersTabProps): ReactElement {
  return (
    <div>
      <h3
        className="text-label uppercase tracking-[0.15em] text-amber-400 mb-2"
        style={MONO_FONT}
      >
        Resource Production Rates
      </h3>
      <SliderRow
        label="Type 1 Dozer"
        tooltip="How many chains of fireline per hour a single dozer can build. NWCG default: 75 (Type 1)."
        value={config.dozerChainsHr}
        defaultValue={DEFAULT_MODEL_CONFIG.dozerChainsHr}
        min={0}
        max={150}
        step={1}
        units="ch/hr"
        onChange={(v) => setConfig({ dozerChainsHr: v })}
        onReset={() =>
          setConfig({ dozerChainsHr: DEFAULT_MODEL_CONFIG.dozerChainsHr })
        }
      />
      <SliderRow
        label="Type 1 Crew"
        tooltip="Type 1 hand crew NWCG production rate. Default: 9 ch/hr."
        value={config.crewChainsHr}
        defaultValue={DEFAULT_MODEL_CONFIG.crewChainsHr}
        min={0}
        max={18}
        step={1}
        units="ch/hr"
        onChange={(v) => setConfig({ crewChainsHr: v })}
        onReset={() =>
          setConfig({ crewChainsHr: DEFAULT_MODEL_CONFIG.crewChainsHr })
        }
      />
      <SliderRow
        label="Engine"
        tooltip="Engine company NWCG production rate. Default: 4 ch/hr."
        value={config.engineChainsHr}
        defaultValue={DEFAULT_MODEL_CONFIG.engineChainsHr}
        min={0}
        max={8}
        step={1}
        units="ch/hr"
        onChange={(v) => setConfig({ engineChainsHr: v })}
        onReset={() =>
          setConfig({ engineChainsHr: DEFAULT_MODEL_CONFIG.engineChainsHr })
        }
      />
      <SliderRow
        label="Helitack swath"
        tooltip="Helicopter drop swath length in chains. Default: 8."
        value={config.helitackSwathChains}
        defaultValue={DEFAULT_MODEL_CONFIG.helitackSwathChains}
        min={0}
        max={16}
        step={1}
        units="chains"
        onChange={(v) => setConfig({ helitackSwathChains: v })}
        onReset={() =>
          setConfig({ helitackSwathChains: DEFAULT_MODEL_CONFIG.helitackSwathChains })
        }
      />

      <h3
        className="text-label uppercase tracking-[0.15em] text-amber-400 mb-2 mt-5"
        style={MONO_FONT}
      >
        Inverse Search
      </h3>
      <SliderRow
        label="Breach tolerance"
        tooltip="Fraction of fire allowed outside the polygon before the candidate fails. Default: 2%."
        value={config.breachTolerancePct}
        defaultValue={DEFAULT_MODEL_CONFIG.breachTolerancePct}
        min={0}
        max={10}
        step={1}
        units="%"
        onChange={(v) => setConfig({ breachTolerancePct: v })}
        onReset={() =>
          setConfig({ breachTolerancePct: DEFAULT_MODEL_CONFIG.breachTolerancePct })
        }
      />
      <SliderRow
        label="Search ceiling"
        tooltip="Maximum line capacity the bisection considers. Above this, recommendation is uncontainable. Default: 2500 ch/hr."
        value={config.searchCeilingChainsHr}
        defaultValue={DEFAULT_MODEL_CONFIG.searchCeilingChainsHr}
        min={500}
        max={5000}
        step={100}
        units="ch/hr"
        onChange={(v) => setConfig({ searchCeilingChainsHr: v })}
        onReset={() =>
          setConfig({
            searchCeilingChainsHr: DEFAULT_MODEL_CONFIG.searchCeilingChainsHr,
          })
        }
      />

      <h3
        className="text-label uppercase tracking-[0.15em] text-amber-400 mb-2 mt-5"
        style={MONO_FONT}
      >
        Resume Window
      </h3>
      <SliderRow
        label="Resume window"
        tooltip="Post-pause simulation length in timesteps. At default 3 min/step, 30 steps = 90 min. Default: 30."
        value={config.resumeWindowSteps}
        defaultValue={DEFAULT_MODEL_CONFIG.resumeWindowSteps}
        min={10}
        max={60}
        step={5}
        units="steps"
        onChange={(v) => setConfig({ resumeWindowSteps: v })}
        onReset={() =>
          setConfig({ resumeWindowSteps: DEFAULT_MODEL_CONFIG.resumeWindowSteps })
        }
      />

      <button
        onClick={resetAll}
        disabled={!isModified}
        className={`mt-4 px-3 py-1.5 rounded ${
          isModified
            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30"
            : "bg-white/5 text-gray-500 border border-white/[0.06] cursor-not-allowed"
        }`}
        style={MONO_FONT}
      >
        Reset all to defaults
      </button>
    </div>
  );
}

function ReferencesTab(): ReactElement {
  return (
    <div>
      <section className="mb-4">
        <h3
          className="text-label uppercase tracking-wider text-amber-400 mb-1"
          style={MONO_FONT}
        >
          Rothermel (1972) — surface fire spread base rate
        </h3>
        <pre
          className="text-micro text-gray-300 bg-white/[0.04] p-2 rounded overflow-x-auto"
          style={MONO_FONT}
        >
{`R = R₀ × (1 + φ_wind + φ_slope) × humidity_factor
φ_wind = C × U^B × (β/βop)^E    (Rothermel-Albini wind alignment)
φ_slope = 5.275 × β^(-0.3) × tan(slope)²`}
        </pre>
        <p className="text-micro text-gray-500 mt-1">
          Used as the deterministic base; ML refines per-cell ignition probability.
        </p>
      </section>

      <section className="mb-4">
        <h3
          className="text-label uppercase tracking-wider text-amber-400 mb-1"
          style={MONO_FONT}
        >
          Albini (1976) — fuel coefficients extension
        </h3>
        <pre
          className="text-micro text-gray-300 bg-white/[0.04] p-2 rounded overflow-x-auto"
          style={MONO_FONT}
        >
{`Reference for fuel coefficients (Grass / Shrub / Forest).`}
        </pre>
      </section>

      <section className="mb-4">
        <h3
          className="text-label uppercase tracking-wider text-amber-400 mb-1"
          style={MONO_FONT}
        >
          NWCG Standards — production rates
        </h3>
        <pre
          className="text-micro text-gray-300 bg-white/[0.04] p-2 rounded overflow-x-auto"
          style={MONO_FONT}
        >
{`Production rates (chains/hr):
  Type 1 Crew:  9    Type 1 Dozer: 75
  Type 2 Crew:  6    Engine:        4
  Helitack:     0 + 8-chain swath × 0.4× spread reduction
  Air Tanker:   0 + 50 chains retardant × 2 drops/hr`}
        </pre>
      </section>

      <section className="mb-4">
        <h3
          className="text-label uppercase tracking-wider text-amber-400 mb-1"
          style={MONO_FONT}
        >
          Hirsch & Martell (1996) — delay decay
        </h3>
        <pre
          className="text-micro text-gray-300 bg-white/[0.04] p-2 rounded overflow-x-auto"
          style={MONO_FONT}
        >
{`delayDecay(min) = max(0.4, 1 − 0.003 × delay_min)`}
        </pre>
        <p className="text-micro text-gray-500 mt-1">
          Long delays don't break suppression; they degrade it linearly down to a 40%
          floor.
        </p>
      </section>

      <section className="mb-4">
        <h3
          className="text-label uppercase tracking-wider text-amber-400 mb-1"
          style={MONO_FONT}
        >
          Reed & McCool (2000) — containment probability
        </h3>
        <pre
          className="text-micro text-gray-300 bg-white/[0.04] p-2 rounded overflow-x-auto"
          style={MONO_FONT}
        >
{`P_contain = 1 − exp(−k × (line_built / active_perimeter))
k = 1.2     (calibrated)`}
        </pre>
      </section>

      <section className="mb-4">
        <h3
          className="text-label uppercase tracking-wider text-amber-400 mb-1"
          style={MONO_FONT}
        >
          Bisection algorithm
        </h3>
        <pre
          className="text-micro text-gray-300 bg-white/[0.04] p-2 rounded overflow-x-auto"
          style={MONO_FONT}
        >
{`Bisection on chains/hr capacity in [0, ceiling]
  For each candidate c:
    roster = cheapestRoster(c)
    run = extendSimulation(grid, polygon, roster)
    passed = breachPercent(run) ≤ tolerance
  Return smallest c where passed`}
        </pre>
      </section>

      <section className="mb-4">
        <h3
          className="text-label uppercase tracking-wider text-amber-400 mb-1"
          style={MONO_FONT}
        >
          Containment check
        </h3>
        <pre
          className="text-micro text-gray-300 bg-white/[0.04] p-2 rounded overflow-x-auto"
          style={MONO_FONT}
        >
{`breachPercent = burningOutside / totalBurning      (0..1 fraction)
ok = burningOutside === 0 || breachPercent ≤ tolerance`}
        </pre>
      </section>

      <section className="mb-2">
        <h3
          className="text-label uppercase tracking-wider text-amber-400 mb-1"
          style={MONO_FONT}
        >
          External links
        </h3>
        <ul className="text-micro text-gray-400 space-y-1" style={MONO_FONT}>
          <li>NWCG: https://www.nwcg.gov/publications</li>
          <li>Rothermel 1972: USDA Forest Service Research Paper INT-115</li>
          <li>ESA WorldCover (10 m vegetation): https://esa-worldcover.org/</li>
        </ul>
      </section>
    </div>
  );
}
