interface TimeInfoPanelProps {
  currentStep: number;
  timestepMinutes: number;
  visible: boolean;
}

function formatDayTime(totalMinutes: number): string {
  const day = Math.floor(totalMinutes / 1440) + 1;
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `Day ${day}, ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

export default function TimeInfoPanel({
  currentStep,
  timestepMinutes,
  visible,
}: TimeInfoPanelProps) {
  if (!visible) return null;

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
