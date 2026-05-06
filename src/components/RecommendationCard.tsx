import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  RESOURCE_RATES,
  ResourceType,
  SUPPRESSION_BUNDLES,
} from "../simulation/types";
import type { ResourceCount } from "../simulation/types";
import type { ApiQBoundaryResponse } from "../services/simulationApi";
import { classifyRoster } from "../utils/cheapestRoster";
import { useModelConfig, DEFAULT_MODEL_CONFIG } from "../contexts/ModelConfig";

interface RecommendationCardProps {
  result: ApiQBoundaryResponse;
  timestepMinutes: number;
  onApprove: (roster: ResourceCount[]) => void;
  onShowBreachPreview: () => void;
  onCancel: () => void;
  onRedraw: () => void;
}

interface RosterOption {
  label: string;
  roster: ResourceCount[];
}

function describeRoster(roster: ResourceCount[]): string {
  if (roster.length === 0) return "no resources needed";
  return roster
    .map((r) => {
      const noun =
        r.type === ResourceType.Type1Crew || r.type === ResourceType.Type2Crew
          ? "crew"
          : r.type === ResourceType.Engine
            ? "engine"
            : r.type === ResourceType.Type1Dozer
              ? "dozer"
              : r.type === ResourceType.Helitack
                ? "helitack"
                : r.type === ResourceType.AirTanker
                  ? "tanker"
                  : "resource";
      const plural = r.count === 1 ? noun : noun + "s";
      return `${r.count} ${plural}`;
    })
    .join(" · ");
}

function totalChainsHr(roster: ResourceCount[]): number {
  return roster.reduce(
    (sum, r) => sum + r.count * (RESOURCE_RATES[r.type]?.chainsPerHour ?? 0),
    0,
  );
}

function totalCostPerHour(roster: ResourceCount[]): number {
  return roster.reduce(
    (sum, r) => sum + r.count * (RESOURCE_RATES[r.type]?.costPerHour ?? 0),
    0,
  );
}

function formatBreachTime(
  breachStep: number | null,
  timestepMinutes: number,
): string {
  if (breachStep === null) return "no breach detected";
  const totalMin = breachStep * timestepMinutes;
  return totalMin < 60
    ? `minute ${totalMin}`
    : `${Math.floor(totalMin / 60)}h ${totalMin % 60}min`;
}

// breachPercent comes from containmentCheck as a fraction in [0, 1].
// Multiply by 100 for display. Tiny non-zero values round up to "<1%"
// instead of hiding as "0%" — matters when a polygon "almost" holds.
function formatBreachPercent(fraction: number): string {
  if (fraction <= 0) return "0%";
  const pct = fraction * 100;
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

function formatCost(perHour: number): string {
  if (perHour >= 1000) return `$${Math.round(perHour / 1000)}k/hr`;
  return `$${perHour}/hr`;
}

const MONO_FONT = { fontFamily: "'JetBrains Mono', monospace" };
const SANS_FONT = { fontFamily: "'DM Sans', sans-serif" };

const ALL_RESOURCE_TYPES: ResourceType[] = [
  ResourceType.Type1Crew,
  ResourceType.Type2Crew,
  ResourceType.Engine,
  ResourceType.Type1Dozer,
  ResourceType.Helitack,
  ResourceType.AirTanker,
];

export default function RecommendationCard(
  props: RecommendationCardProps,
): ReactElement {
  const {
    result,
    timestepMinutes,
    onApprove,
    onShowBreachPreview,
    onCancel,
    onRedraw,
  } = props;

  const { config: modelConfig, setConfig: setModelConfig, resetAll: resetModel, isModified: modelIsModified } = useModelConfig();
  const [methodOpen, setMethodOpen] = useState(false);
  const [breachDetailOpen, setBreachDetailOpen] = useState(false);

  const containable = result.recommendedRoster !== null;
  const primaryRoster: ResourceCount[] = containable
    ? (result.recommendedRoster as ResourceCount[])
    : result.bestEffortRoster;

  const options: RosterOption[] = useMemo(() => {
    return [
      {
        label: `Recommended (${describeRoster(primaryRoster)})`,
        roster: primaryRoster,
      },
      {
        label: "Initial Attack (Type2Crew + Engine + Helitack)",
        roster: SUPPRESSION_BUNDLES.initialAttack,
      },
      { label: "Type 3 Medium", roster: SUPPRESSION_BUNDLES.type3 },
      { label: "Type 2 Large", roster: SUPPRESSION_BUNDLES.type2 },
      { label: "Type 1 Maximum", roster: SUPPRESSION_BUNDLES.type1 },
      { label: "Custom...", roster: [] },
    ];
  }, [primaryRoster]);

  const [selectedRosterIndex, setSelectedRosterIndex] = useState<number>(0);
  const [customRoster, setCustomRoster] = useState<ResourceCount[]>([]);
  const [confirmedDangerous, setConfirmedDangerous] = useState(false);

  const isCustom = selectedRosterIndex === options.length - 1;
  const selectedRoster: ResourceCount[] = isCustom
    ? customRoster
    : options[selectedRosterIndex].roster;

  const recommendedCapacity = totalChainsHr(primaryRoster);
  const selectedCapacity = totalChainsHr(selectedRoster);
  const underCommitted = containable && selectedCapacity < recommendedCapacity;

  const handleApprove = () => {
    if (!containable) {
      onApprove(selectedRoster);
      return;
    }
    if (!underCommitted || confirmedDangerous) {
      onApprove(selectedRoster);
      return;
    }
    setConfirmedDangerous(true);
  };

  const handleSelectChange = (idx: number) => {
    setSelectedRosterIndex(idx);
    setConfirmedDangerous(false);
  };

  const updateCustomCount = (type: ResourceType, count: number) => {
    setCustomRoster((prev) => {
      const next = prev.filter((r) => r.type !== type);
      if (count > 0) next.push({ type, count });
      return next;
    });
    setConfirmedDangerous(false);
  };

  const failingDescriptor =
    result.failingRun !== null
      ? `${describeRoster(
          result.bisectionTrace.find((b) => !b.passed)?.roster ?? [],
        )} breaches at ${formatBreachTime(result.breachStep, timestepMinutes)} — ${formatBreachPercent(result.breachPercent)} outside boundary`
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        ...SANS_FONT,
      }}
    >
      <div
        className="fire-panel rounded-2xl text-white"
        style={{ width: 480, maxWidth: "92vw", ...SANS_FONT }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2"
          style={{
            background: containable
              ? "transparent"
              : "rgba(220, 38, 38, 0.12)",
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: containable ? "var(--fire-amber)" : "var(--fire-red)",
              boxShadow: containable
                ? "0 0 6px rgba(245,158,11,0.5)"
                : "0 0 6px rgba(220,38,38,0.6)",
            }}
          />
          <h2
            className="text-caption font-bold tracking-[0.2em] uppercase"
            style={{
              color: containable ? "var(--fire-amber)" : "var(--fire-red)",
              ...MONO_FONT,
            }}
          >
            {containable
              ? "Minimum Effective Response"
              : "Uncontainable At This Boundary"}
          </h2>
        </div>

        <div className="px-5 py-4 space-y-4">
          {containable ? (
            <>
              <div>
                <div className="text-base font-semibold text-amber-200 mb-1">
                  {describeRoster(primaryRoster)}
                </div>
                {(() => {
                  const tier = classifyRoster(primaryRoster);
                  const isSurge = tier.key === "surge";
                  return (
                    <div className="mb-1">
                      <span
                        className={`inline-block text-label uppercase tracking-wider px-2 py-0.5 rounded ${
                          isSurge
                            ? "bg-red-500/15 text-red-300 border border-red-500/30"
                            : "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                        }`}
                        style={MONO_FONT}
                      >
                        {tier.label}
                      </span>
                      {tier.caveat && (
                        <div className="text-micro text-red-200/80 mt-1 leading-snug">
                          {tier.caveat}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div
                  className="text-micro text-gray-400 tabular-nums"
                  style={MONO_FONT}
                >
                  Total line capacity: {recommendedCapacity} chains/hr
                </div>
                <div
                  className="text-micro text-gray-400 tabular-nums"
                  style={MONO_FONT}
                >
                  Estimated cost: {formatCost(totalCostPerHour(primaryRoster))}
                </div>
              </div>

              {failingDescriptor && (
                <div className="border-t border-white/[0.06] pt-3 space-y-1.5">
                  <div className="text-sm text-gray-300 leading-relaxed">
                    Smaller roster ({failingDescriptor}).
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBreachDetailOpen((v) => !v);
                      onShowBreachPreview();
                    }}
                    className="text-label uppercase tracking-wider text-amber-400
                      hover:text-amber-300 underline cursor-pointer"
                    style={MONO_FONT}
                  >
                    {breachDetailOpen ? "Hide breach detail" : "Show breach detail"}
                  </button>
                  {breachDetailOpen && (
                    <div
                      className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-micro text-red-200/90 leading-relaxed"
                      style={MONO_FONT}
                    >
                      Failing capacity:{" "}
                      <span className="text-red-200 font-semibold">
                        {result.bisectionTrace.find((b) => !b.passed)?.capacityChainsHr ?? 0} ch/hr
                      </span>
                      <br />
                      Breach moment:{" "}
                      <span className="text-red-200 font-semibold">
                        {formatBreachTime(result.breachStep, timestepMinutes)}
                      </span>
                      <br />
                      Outside boundary:{" "}
                      <span className="text-red-200 font-semibold">
                        {formatBreachPercent(result.breachPercent)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <div className="text-sm text-gray-200 leading-relaxed">
                  Maximum response ({describeRoster(primaryRoster)}) breaches at{" "}
                  <span className="text-red-300">
                    {formatBreachTime(result.breachStep, timestepMinutes)}
                  </span>{" "}
                  &mdash;{" "}
                  <span className="text-red-300 tabular-nums">
                    {formatBreachPercent(result.breachPercent)}
                  </span>{" "}
                  outside boundary.
                </div>
              </div>
              <div className="border-t border-white/[0.06] pt-3">
                <div
                  className="text-label uppercase tracking-[0.15em] text-gray-400 mb-1"
                  style={MONO_FONT}
                >
                  Closest to containment
                </div>
                <div className="text-sm text-amber-200">
                  Limits breach to{" "}
                  <span className="tabular-nums">
                    {formatBreachPercent(result.breachPercent)}
                  </span>
                  .
                </div>
              </div>
              <div className="border-t border-white/[0.06] pt-3">
                <div className="text-sm text-gray-300 leading-relaxed">
                  No realistic resource bundle holds this line. Consider
                  drawing a <span className="text-amber-400">larger boundary</span>{" "}
                  with more standoff, or deploy best effort to minimize loss.
                </div>
              </div>
            </>
          )}

          <div className="border-t border-white/[0.06] pt-3">
            <div className="flex items-center gap-2">
              <span
                className="text-label uppercase tracking-[0.15em] text-gray-400"
                style={MONO_FONT}
              >
                Override
              </span>
              <select
                value={selectedRosterIndex}
                onChange={(e) =>
                  handleSelectChange(parseInt(e.target.value, 10))
                }
                className="flex-1 bg-white/[0.04] border border-white/[0.06] rounded-lg
                  px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-amber-500/40"
              >
                {options.map((opt, i) => (
                  <option key={i} value={i}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {isCustom && (
              <div className="mt-3 space-y-1.5 pl-2 border-l border-amber-500/20">
                {ALL_RESOURCE_TYPES.map((rt) => {
                  const cur = customRoster.find((r) => r.type === rt)?.count ?? 0;
                  const meta = RESOURCE_RATES[rt];
                  return (
                    <div
                      key={rt}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-gray-300">{meta.label}</span>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={cur}
                        onChange={(e) =>
                          updateCustomCount(
                            rt,
                            Math.max(0, parseInt(e.target.value, 10) || 0),
                          )
                        }
                        className="w-14 bg-white/[0.04] border border-white/[0.06] rounded
                          text-center text-sm text-gray-200 outline-none
                          focus:border-amber-500/40"
                      />
                    </div>
                  );
                })}
                <div
                  className="text-micro text-gray-500 pt-1"
                  style={MONO_FONT}
                >
                  {totalChainsHr(customRoster)} chains/hr ·{" "}
                  {formatCost(totalCostPerHour(customRoster))}
                </div>
              </div>
            )}

            {containable && underCommitted && confirmedDangerous && (
              <div
                className="mt-3 px-3 py-2 rounded-lg text-sm leading-relaxed"
                style={{
                  background: "rgba(220,38,38,0.12)",
                  border: "1px solid rgba(220,38,38,0.35)",
                  color: "#FCA5A5",
                }}
              >
                Warning: this bundle ({selectedCapacity} chains/hr) is below the
                recommended {recommendedCapacity} chains/hr and is expected to
                breach at {formatBreachTime(result.breachStep, timestepMinutes)}.
                Click Approve again to proceed.
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.06] pt-3">
            <button
              type="button"
              onClick={() => setMethodOpen((v) => !v)}
              className="w-full flex items-center justify-between text-label
                uppercase tracking-[0.15em] text-gray-300 hover:text-amber-200
                transition-colors cursor-pointer"
              style={MONO_FONT}
            >
              <span className="flex items-center gap-2">
                <span className="text-amber-400">{methodOpen ? "▼" : "▶"}</span>
                Methodology &amp; Parameters
                {modelIsModified && (
                  <span className="text-micro text-amber-400/80 normal-case tracking-normal">(modified — auto-recomputing)</span>
                )}
              </span>
              {modelIsModified && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    resetModel();
                  }}
                  className="text-micro normal-case tracking-normal
                    text-amber-400 hover:text-amber-200 underline"
                >
                  Reset
                </button>
              )}
            </button>

            {methodOpen && (
              <div className="mt-3 space-y-4">
                <p className="text-sm text-gray-300 leading-relaxed">
                  Bisection on chains/hr capacity. For each candidate the system
                  builds a cheapest-mix roster (greedy by $/chain), runs a
                  {" "}{modelConfig.resumeWindowSteps}-step extension simulation,
                  and accepts the result if at most {modelConfig.breachTolerancePct}%
                  of burning cells fall outside your polygon. Tweaks below
                  re-run the bisection automatically.
                </p>

                <ParamSection title="Resource production rates">
                  <ParamSlider label="Type 1 Dozer" units="ch/hr" value={modelConfig.dozerChainsHr}
                    defaultValue={DEFAULT_MODEL_CONFIG.dozerChainsHr}
                    min={0} max={150} step={1}
                    onChange={(v) => setModelConfig({ dozerChainsHr: v })} />
                  <ParamSlider label="Type 1 Crew" units="ch/hr" value={modelConfig.crewChainsHr}
                    defaultValue={DEFAULT_MODEL_CONFIG.crewChainsHr}
                    min={0} max={18} step={1}
                    onChange={(v) => setModelConfig({ crewChainsHr: v })} />
                  <ParamSlider label="Engine" units="ch/hr" value={modelConfig.engineChainsHr}
                    defaultValue={DEFAULT_MODEL_CONFIG.engineChainsHr}
                    min={0} max={8} step={1}
                    onChange={(v) => setModelConfig({ engineChainsHr: v })} />
                  <ParamSlider label="Helitack swath" units="chains" value={modelConfig.helitackSwathChains}
                    defaultValue={DEFAULT_MODEL_CONFIG.helitackSwathChains}
                    min={0} max={16} step={1}
                    onChange={(v) => setModelConfig({ helitackSwathChains: v })} />
                </ParamSection>

                <ParamSection title="Inverse search">
                  <ParamSlider label="Breach tolerance" units="%" value={modelConfig.breachTolerancePct}
                    defaultValue={DEFAULT_MODEL_CONFIG.breachTolerancePct}
                    min={0} max={10} step={1}
                    onChange={(v) => setModelConfig({ breachTolerancePct: v })} />
                  <ParamSlider label="Search ceiling" units="ch/hr" value={modelConfig.searchCeilingChainsHr}
                    defaultValue={DEFAULT_MODEL_CONFIG.searchCeilingChainsHr}
                    min={500} max={5000} step={100}
                    onChange={(v) => setModelConfig({ searchCeilingChainsHr: v })} />
                </ParamSection>

                <ParamSection title="Resume window">
                  <ParamSlider label="Post-pause sim duration" units="steps" value={modelConfig.resumeWindowSteps}
                    defaultValue={DEFAULT_MODEL_CONFIG.resumeWindowSteps}
                    min={10} max={60} step={5}
                    onChange={(v) => setModelConfig({ resumeWindowSteps: v })} />
                </ParamSection>
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.06] pt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleApprove}
              className="flex-1 px-3 py-2 rounded-lg text-label uppercase tracking-wider
                font-semibold cursor-pointer transition-colors
                bg-amber-500/15 text-amber-300 hover:bg-amber-500/25
                border border-amber-500/30"
              style={MONO_FONT}
            >
              {containable ? "Approve & Deploy" : "Deploy (best effort)"}
            </button>
            <button
              type="button"
              onClick={onRedraw}
              className="px-3 py-2 rounded-lg text-label uppercase tracking-wider
                font-semibold cursor-pointer transition-colors
                bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]
                border border-white/[0.06]"
              style={MONO_FONT}
            >
              Redraw
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-2 rounded-lg text-label uppercase tracking-wider
                font-semibold cursor-pointer transition-colors
                bg-white/[0.04] text-gray-400 hover:bg-white/[0.08]
                border border-white/[0.06]"
              style={MONO_FONT}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ParamSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div>
      <div
        className="text-label uppercase tracking-[0.15em] text-gray-500 mb-1.5"
        style={MONO_FONT}
      >
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

interface ParamSliderProps {
  label: string;
  units: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}

function ParamSlider({
  label,
  units,
  value,
  defaultValue,
  min,
  max,
  step,
  onChange,
}: ParamSliderProps): ReactElement {
  const modified = value !== defaultValue;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-sm text-gray-300">{label}</span>
        <div className="flex items-baseline gap-2">
          <span
            className={`text-sm tabular-nums ${
              modified ? "text-amber-300" : "text-gray-300"
            }`}
            style={MONO_FONT}
          >
            {value} {units}
          </span>
          <button
            type="button"
            onClick={() => onChange(defaultValue)}
            className={`text-micro ${
              modified
                ? "text-amber-400/70 hover:text-amber-300 cursor-pointer"
                : "text-gray-600 cursor-not-allowed"
            }`}
            disabled={!modified}
            title="Reset to default"
            style={MONO_FONT}
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
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-amber-500"
      />
    </div>
  );
}
