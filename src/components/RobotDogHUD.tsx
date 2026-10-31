import type { ReactElement } from "react";
import type { MissionPhase } from "../simulation/robot/mission";

interface RobotDogHUDProps {
  phase: MissionPhase | null;
  event: string | null;
  marginMin: number;
  windLabel: string;
  windShifted: boolean;
  shiftPending: boolean;
  onWindShift: () => void;
  onExit: () => void;
  follow: boolean;
  onToggleFollow: () => void;
  /** Placement prompt or notice shown before/while placing. */
  notice?: string | null;
}

export const MOCK_LABEL = "Mock simulation — planning on the model's fire forecast. No physical robot.";

const PHASE_LABEL: Record<MissionPhase, string> = {
  outbound: "Scouting route",
  scouting: "At fire edge",
  returning: "Returning",
  retreating: "Retreating",
  holding: "No safe path — holding",
  done: "Safe at staging",
};

function formatMargin(min: number): string {
  if (!Number.isFinite(min)) return "clear";
  if (min < 0) return "in fire";
  if (min < 120) return `${Math.round(min)} min`;
  return `${(min / 60).toFixed(1)} h`;
}

export default function RobotDogHUD({
  phase,
  event,
  marginMin,
  windLabel,
  windShifted,
  shiftPending,
  onWindShift,
  onExit,
  follow,
  onToggleFollow,
  notice,
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
          <div className="text-gray-300 tabular-nums">Fire margin: {formatMargin(marginMin)}</div>
          <div className="text-gray-400">{windLabel}</div>
          {event && <div className="text-amber-300">{event}</div>}
        </div>
      ) : null}

      {notice && <div className="text-amber-300 mb-3">{notice}</div>}

      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={onWindShift}
          disabled={!phase || phase === "done" || windShifted || shiftPending}
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
        <span><span className="inline-block w-3 h-1 align-middle mr-1" style={{ background: "#2E8540" }} />escape path</span>
      </div>

      <div className="border-t border-white/[0.08] pt-2 text-micro text-amber-200/90 leading-snug">
        {MOCK_LABEL}
      </div>
    </div>
  );
}
