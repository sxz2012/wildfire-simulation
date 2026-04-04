interface TimeInfoPanelProps {
  currentStep: number;
  timestepMinutes: number;
  visible: boolean;
  historicalDates?: string[];
}

function formatDayTime(totalMinutes: number): string {
  const day = Math.floor(totalMinutes / 1440) + 1;
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `Day ${day}, ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
  if (dateStr.startsWith("Day") || dateStr.startsWith("Before")) return dateStr;
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function TimeInfoPanel({
  currentStep,
  timestepMinutes,
  visible,
  historicalDates,
}: TimeInfoPanelProps) {
  if (!visible) return null;

  const isHistorical = historicalDates && historicalDates.length > 0;
  const startLabel = isHistorical ? formatDate(historicalDates[0]) : formatDayTime(0);
  const currentLabel = isHistorical
    ? formatDate(historicalDates[Math.min(currentStep, historicalDates.length - 1)])
    : formatDayTime(currentStep * timestepMinutes);

  return (
    <div className="fire-panel absolute top-3 right-3 z-50 rounded-xl px-4 py-3 min-w-[180px]">
      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/[0.04]">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse" />
        <span
          className="text-[10px] font-semibold tracking-[0.2em] uppercase text-gray-400"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {isHistorical ? "Replay Active" : "Simulation"}
        </span>
      </div>

      <div className="space-y-2.5">
        <div>
          <div
            className="text-[9px] font-medium tracking-[0.15em] uppercase mb-0.5"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
          >
            Origin
          </div>
          <div className="text-sm text-gray-200" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            {startLabel}
          </div>
        </div>

        <div>
          <div
            className="text-[9px] font-medium tracking-[0.15em] uppercase mb-0.5"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
          >
            Current
          </div>
          <div
            className="text-sm font-bold"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--fire-amber)" }}
          >
            {currentLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
