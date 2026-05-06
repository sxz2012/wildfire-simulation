import type { ReactElement, ReactNode } from "react";
import type {
  SimulationConfig,
  SuppressionConfig,
  SuppressionStepDiag,
} from "../simulation/types";
import type { DropEvent } from "../utils/dropScheduler";
import { perTypeCounts } from "../utils/perTypeCounts";

interface SuppressionHUDProps {
  diags: SuppressionStepDiag[];
  config: SimulationConfig;
  suppression: SuppressionConfig;
  deployStep: number;
  endStep: number;
  currentStep: number;
  dropEvents: DropEvent[];
  bundleLabel: string;
}

function formatMeters(m: number): string {
  return `${Math.round(m).toLocaleString()} m`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export default function SuppressionHUD({
  diags,
  config,
  suppression,
  deployStep,
  endStep,
  currentStep,
  dropEvents,
  bundleLabel,
}: SuppressionHUDProps): ReactElement | null {
  if (suppression.resources.length === 0) return null;

  // Day-N + HH:MM derived from currentStep * timestepMinutes (1440 min/day).
  const totalMinutes = currentStep * config.timestepMinutes;
  const day = Math.floor(totalMinutes / 1440) + 1;
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;
  const timeLabel = `Day ${day}, ${pad2(hours)}:${pad2(mins)}`;

  const counts = perTypeCounts({
    bundle: suppression.resources,
    step: currentStep,
    deployStep,
    endStep,
  });

  let dropTimeLabel = "n/a";
  let lastDropCenter: number | null = null;
  for (const ev of dropEvents) {
    if (ev.centerStep <= currentStep) {
      if (lastDropCenter === null || ev.centerStep > lastDropCenter) {
        lastDropCenter = ev.centerStep;
      }
    }
  }
  if (lastDropCenter !== null) {
    const elapsedSteps = currentStep - lastDropCenter;
    const elapsedMin = elapsedSteps * config.timestepMinutes;
    dropTimeLabel = `${pad2(Math.floor(elapsedMin / 60))}:${pad2(elapsedMin % 60)} ago`;
  }

  const lineMeters = diags[currentStep]?.cumulativeLineMeters ?? 0;
  const lineLabel = formatMeters(lineMeters);

  const lookback = Math.min(5, currentStep);
  const earlier = diags[currentStep - lookback]?.cumulativeLineMeters ?? 0;
  const current = diags[currentStep]?.cumulativeLineMeters ?? 0;
  const windowMinutes = lookback * config.timestepMinutes;
  let rate = 0;
  if (windowMinutes > 0 && currentStep >= deployStep) {
    rate = Math.round((current - earlier) / windowMinutes);
  }
  const rateLabel = `▲ ${rate.toLocaleString()} m/min`;

  const perimeter = diags[currentStep]?.activePerimeterMeters ?? 0;
  const perimeterLabel = formatMeters(perimeter);

  const containment = (diags[currentStep]?.containmentProbability ?? 0) * 100;
  const containmentLabel = `${Math.round(containment)} %`;
  const blocks = Math.max(0, Math.min(10, Math.round(containment / 10)));
  const containmentBar = "█".repeat(blocks) + "░".repeat(10 - blocks);
  const containmentColor = containment >= 100 ? "text-emerald-400" : "text-amber-400";

  const showContainedFooter =
    currentStep >= endStep && (diags[endStep]?.activePerimeterMeters ?? 1) === 0;
  const endTotalMinutes = endStep * config.timestepMinutes;
  const endHours = Math.floor((endTotalMinutes % 1440) / 60);
  const endMins = endTotalMinutes % 60;
  const containedTimeLabel = `${pad2(endHours)}:${pad2(endMins)}`;

  const hasTanker = counts.tankers > 0;

  return (
    <div
      className="fire-panel rounded-lg p-3 w-[280px] text-sm"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      <div
        className="text-label font-medium tracking-[0.15em] uppercase mb-2 text-amber-400"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        Active Response
      </div>

      <div
        className="text-micro text-gray-500 mb-2 tabular-nums"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {timeLabel} &nbsp;·&nbsp; bundle: {bundleLabel}
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-gray-300 mb-3">
        <div>👷 {counts.crews} crews</div>
        <div>🚒 {counts.engines} engines</div>
        <div>🚜 {counts.dozers} dozers</div>
        <div>🚁 {counts.helitack} helitack</div>
        {hasTanker && (
          <div className="col-span-2">
            ✈️ {counts.tankers} tanker{counts.tankers === 1 ? "" : "s"} ({dropTimeLabel})
          </div>
        )}
      </div>

      <div className="border-t border-white/[0.06] pt-2 space-y-1.5 text-gray-300">
        <Row
          label="Line built"
          value={lineLabel}
          extra={
            <span
              className="text-micro text-emerald-400 tabular-nums"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {rateLabel}
            </span>
          }
        />
        <Row label="Active perimeter" value={perimeterLabel} />
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Containment</span>
          <span className="flex items-center gap-2">
            <span
              className={containmentColor}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {containmentBar}
            </span>
            <span
              className={`tabular-nums ${containmentColor}`}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {containmentLabel}
            </span>
          </span>
        </div>
      </div>

      {showContainedFooter && (
        <div
          className="border-t border-white/[0.06] mt-2 pt-2 text-emerald-400 text-micro tracking-wider uppercase"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          Fire contained — {containedTimeLabel}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  extra,
}: {
  label: string;
  value: string;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="flex items-baseline gap-2">
        <span
          className="tabular-nums text-gray-200"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {value}
        </span>
        {extra}
      </span>
    </div>
  );
}
