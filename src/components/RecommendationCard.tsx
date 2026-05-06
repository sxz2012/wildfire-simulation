import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  RESOURCE_RATES,
  ResourceType,
  SUPPRESSION_BUNDLES,
} from "../simulation/types";
import type { ResourceCount } from "../simulation/types";
import type { ApiQBoundaryResponse } from "../services/simulationApi";

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
                    onClick={onShowBreachPreview}
                    className="text-label uppercase tracking-wider text-amber-400
                      hover:text-amber-300 underline cursor-pointer"
                    style={MONO_FONT}
                  >
                    Show breach preview
                  </button>
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
