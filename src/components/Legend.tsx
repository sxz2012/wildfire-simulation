interface LegendProps {
  mode: "simulation" | "historical";
  visible: boolean;
}

export default function Legend({ mode, visible }: LegendProps) {
  if (!visible) return null;

  const items =
    mode === "historical"
      ? [
          { color: "#FF4500", glow: "rgba(255,69,0,0.4)", label: "Active fire" },
          { color: "#CC2200", glow: "rgba(204,34,0,0.3)", label: "Burned area" },
          { color: "rgba(150,150,150,0.5)", glow: "rgba(150,150,150,0.3)", label: "Smoke" },
        ]
      : [
          { color: "#FF8C00", glow: "rgba(255,140,0,0.4)", label: "Burning" },
          { color: "#CC2200", glow: "rgba(204,34,0,0.3)", label: "Recently burned" },
          { color: "#1a1a1a", glow: "none", label: "Burned out" },
        ];

  return (
    <div className="fire-panel animate-enter-right absolute bottom-16 right-3 z-50 rounded-xl px-3.5 py-3 min-w-[150px]">
      <div
        className="text-label font-semibold tracking-[0.2em] uppercase mb-2.5 pb-1.5 border-b border-white/[0.04]"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        Legend
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{
                backgroundColor: item.color,
                boxShadow: item.glow !== "none" ? `0 0 6px ${item.glow}` : undefined,
              }}
            />
            <span className="text-sm text-gray-400">{item.label}</span>
          </div>
        ))}
      </div>
      <div
        className="text-label mt-2.5 pt-2 border-t border-white/[0.04]"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        {mode === "historical" ? "NASA FIRMS" : "Rothermel Model"}
      </div>
    </div>
  );
}
