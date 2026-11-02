import type { ReactElement } from "react";
import type { MissionPhase } from "../simulation/robot/mission";

interface RobotDogHUDProps {
  phase: MissionPhase | null;
  event: string | null;
  /** Distance from the dog to the predicted fire now, metres (Infinity = none within reach). */
  fireDistanceM: number;
  /** The distance the dog keeps from the predicted fire, if any. */
  keepAwayM?: number;
  windLabel: string;
  windShifted: boolean;
  shiftPending: boolean;
  onWindShift: () => void;
  onExit: () => void;
  follow: boolean;
  onToggleFollow: () => void;
  /** Placement prompt or notice shown before/while placing. */
  notice?: string | null;
  /** Forecast vs true fire overlap, percent; null before launch. */
  matchPct?: number | null;
  /** Latest dog report, shown as one line once its card has collapsed. */
  lastReport?: { matchBefore: number; matchAfter: number } | null;
  /** A re-forecast (launch, report) is in flight. */
  busy?: boolean;
}

export const MOCK_LABEL = "Mock simulation — planning on the model's fire forecast. No physical robot.";

const PHASE_LABEL: Record<MissionPhase, string> = {
  outbound: "Scouting route",
  scouting: "Scouting",
  returning: "Returning",
  retreating: "Retreating",
  holding: "No safe path — holding",
  done: "Safe at staging",
};

function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return "over 3 km away";
  if (m <= 0) return "here";
  if (m < 1000) return `${Math.round(m / 10) * 10} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

export default function RobotDogHUD({
  phase,
  event,
  fireDistanceM,
  keepAwayM,
  windLabel,
  windShifted,
  shiftPending,
  onWindShift,
  onExit,
  follow,
  onToggleFollow,
  notice,
  matchPct = null,
  lastReport = null,
  busy = false,
}: RobotDogHUDProps): ReactElement {
  const danger = phase === "holding";
  const retreat = phase === "retreating";
  return (
    <div className="fire-panel rounded-lg p-3 w-[300px] text-sm" data-testid="robot-hud">
      <div className="flex items-center justify-between mb-2">
        <span className="text-label font-medium tracking-[0.15em] uppercase text-sky-400">
          🐕 Robot dog
        </span>
        <label className="flex items-center gap-1.5 text-micro text-gray-400 cursor-pointer">
          <input type="checkbox" checked={follow} onChange={onToggleFollow} />
          Follow dog
        </label>
      </div>

      {phase ? (
        <div className="space-y-1 mb-3">
          <div
            className={`text-base font-semibold ${
              danger ? "text-red-400" : retreat ? "text-amber-300" : "text-white"
            }`}
          >
            {PHASE_LABEL[phase]}
          </div>
          <div className="text-gray-300 tabular-nums">Predicted fire: {formatDistance(fireDistanceM)}</div>
          {keepAwayM !== undefined && <div className="text-gray-500">Keeps {keepAwayM} m from it</div>}
          <div className="text-gray-400">{windLabel}</div>
          {matchPct !== null && <div className="text-gray-200 tabular-nums">Forecast match: {matchPct}%</div>}
          {lastReport && (
            <div className="text-sky-300 tabular-nums">
              Last report: {lastReport.matchBefore}% → {lastReport.matchAfter}%
            </div>
          )}
          {event && <div className="text-amber-300">{event}</div>}
        </div>
      ) : null}

      {notice && <div className="text-amber-300 mb-3">{notice}</div>}

      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={onWindShift}
          disabled={!phase || phase === "done" || windShifted || shiftPending || busy}
          className="flex-1 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1.5 text-white"
        >
          {shiftPending ? "Re-forecasting…" : "🌬 Wind shift"}
        </button>
        <button
          type="button"
          onClick={onExit}
          className="flex-1 rounded bg-white/10 hover:bg-white/20 px-2 py-1.5 text-gray-200"
        >
          Exit robot mode
        </button>
      </div>

      <div className="flex gap-3 text-micro text-gray-400 mb-2">
        <span><span className="inline-block w-3 h-1 align-middle mr-1" style={{ background: "#2D6CDF" }} />route</span>
        <span><span className="inline-block w-3 h-1 align-middle mr-1" style={{ background: "#2E8540" }} />escape path ➜ home</span>
        <span><span className="inline-block w-1.5 h-1.5 rounded-full align-middle mr-1" style={{ background: "#FFF3A0" }} />forecast edge</span>
      </div>

      <div className="border-t border-white/[0.08] pt-2 text-micro text-amber-200/90 leading-snug">
        {MOCK_LABEL}
      </div>
    </div>
  );
}
