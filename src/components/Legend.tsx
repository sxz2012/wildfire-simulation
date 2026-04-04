interface LegendProps {
  mode: "simulation" | "historical";
  visible: boolean;
}

export default function Legend({ mode, visible }: LegendProps) {
  if (!visible) return null;

  const items =
    mode === "historical"
      ? [
          { color: "#FF4500", label: "Active fire (current day)" },
          { color: "#CC2200", label: "Previously burned area" },
          { color: "rgba(150,150,150,0.6)", label: "Smoke plume", shape: "blur" },
        ]
      : [
          { color: "#FF8C00", label: "Actively burning" },
          { color: "#8C1E1E", label: "Recently burned" },
          { color: "#0F0F0F", label: "Burned out" },
        ];

  return (
    <div className="absolute bottom-16 right-4 z-50 bg-gray-900/90 backdrop-blur text-white px-4 py-3 rounded-lg text-xs">
      <div className="text-gray-400 font-medium mb-2">Legend</div>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-full flex-shrink-0"
              style={{
                backgroundColor: item.color,
                boxShadow:
                  item.shape === "blur"
                    ? "0 0 4px 2px rgba(150,150,150,0.4)"
                    : undefined,
              }}
            />
            <span className="text-gray-300">{item.label}</span>
          </div>
        ))}
      </div>
      <div className="text-gray-500 mt-2 border-t border-gray-700 pt-2">
        {mode === "historical"
          ? "Source: NASA FIRMS satellite data"
          : "Simplified Rothermel fire model"}
      </div>
    </div>
  );
}
