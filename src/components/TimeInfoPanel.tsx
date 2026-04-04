interface TimeInfoPanelProps {
  currentStep: number;
  timestepMinutes: number;
  visible: boolean;
  /** For historical fire replay */
  historicalDates?: string[];
}

function formatDayTime(totalMinutes: number): string {
  const day = Math.floor(totalMinutes / 1440) + 1;
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `Day ${day}, ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
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

  // Historical mode — show real dates
  if (historicalDates && historicalDates.length > 0) {
    const startDate = historicalDates[0];
    const currentDate = historicalDates[Math.min(currentStep, historicalDates.length - 1)];
    return (
      <div className="absolute top-4 right-4 z-50 bg-gray-900/90 backdrop-blur text-white px-4 py-3 rounded-lg font-mono text-sm">
        <div className="text-gray-400 text-xs mb-1">Fire Started</div>
        <div>{formatDate(startDate)}</div>
        <div className="text-gray-400 text-xs mt-2 mb-1">Current Date</div>
        <div className="text-orange-400 font-bold">{formatDate(currentDate)}</div>
      </div>
    );
  }

  // Simulation mode — show day/time
  const currentMinutes = currentStep * timestepMinutes;
  return (
    <div className="absolute top-4 right-4 z-50 bg-gray-900/90 backdrop-blur text-white px-4 py-3 rounded-lg font-mono text-sm">
      <div className="text-gray-400 text-xs mb-1">Fire Started</div>
      <div>{formatDayTime(0)}</div>
      <div className="text-gray-400 text-xs mt-2 mb-1">Current Time</div>
      <div className="text-orange-400 font-bold">{formatDayTime(currentMinutes)}</div>
    </div>
  );
}
