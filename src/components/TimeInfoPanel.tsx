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
  const hasTime = dateStr.includes("T");
  // ISO with T (and possibly Z) — parse as instant, render in local timezone.
  // Date-only strings (historical FIRMS data) — render in UTC to avoid drift.
  const parsed = hasTime
    ? new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z")
    : new Date(dateStr + "T00:00:00Z");
  if (isNaN(parsed.getTime())) return dateStr;
  const dateOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  if (!hasTime) {
    dateOpts.timeZone = "UTC";
    timeOpts.timeZone = "UTC";
  }
  return parsed.toLocaleDateString("en-US", dateOpts) + " " +
    parsed.toLocaleTimeString("en-US", timeOpts);
}

export default function TimeInfoPanel({
  currentStep,
  timestepMinutes,
  visible,
  historicalDates,
}: TimeInfoPanelProps) {
  if (!visible) return null;

  // Use real frame timestamps when available (historical replays AND live-weather
  // simulations). Fall back to "Day N, HH:MM" relative labels for seasonal/custom
  // simulations that don't have a wall-clock origin.
  const haveDates = historicalDates && historicalDates.length > 0;
  const isHistorical = haveDates;
  const startLabel = haveDates ? formatDate(historicalDates[0]) : formatDayTime(0);
  const currentLabel = haveDates
    ? formatDate(historicalDates[Math.min(currentStep, historicalDates.length - 1)])
    : formatDayTime(currentStep * timestepMinutes);

  return (
    <div className="fire-panel animate-enter-right absolute top-3 right-3 z-50 rounded-xl px-4 py-3 min-w-[180px]">
      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/[0.04]">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse" />
        <span
          className="text-caption font-semibold tracking-[0.2em] uppercase text-gray-400"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {isHistorical ? "Replay Active" : "Simulation"}
        </span>
      </div>

      <div className="space-y-2.5">
        <div>
          <div
            className="text-label font-medium tracking-[0.15em] uppercase mb-0.5"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
          >
            Origin
          </div>
          <div className="text-base text-gray-200" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            {startLabel}
          </div>
        </div>

        <div>
          <div
            className="text-label font-medium tracking-[0.15em] uppercase mb-0.5"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
          >
            Current
          </div>
          <div
            className="text-base font-bold"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--fire-amber)" }}
          >
            {currentLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
