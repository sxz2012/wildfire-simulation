interface InfoTooltipProps {
  x: number;
  y: number;
  cellState: string;
  elevation: number;
  fuel: string;
  visible: boolean;
}

export default function InfoTooltip({
  x,
  y,
  cellState,
  elevation,
  fuel,
  visible,
}: InfoTooltipProps) {
  if (!visible) return null;

  return (
    <div
      className="absolute z-50 bg-gray-900/90 backdrop-blur text-white text-xs px-3 py-2 rounded-lg pointer-events-none"
      style={{ left: x + 15, top: y - 10 }}
    >
      <div>State: {cellState}</div>
      <div>Elevation: {elevation.toFixed(0)}m</div>
      <div>Fuel: {fuel}</div>
    </div>
  );
}
