import { useState } from "react";

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  jsonPath: string;
}

const SCENARIOS: ScenarioSummary[] = [
  {
    id: "cupertino-wui",
    name: "Cupertino WUI",
    description:
      "Westerly wind pushes a fire from the Santa Cruz foothills toward Cupertino.",
    jsonPath: new URL("../data/scenarios/cupertino-wui.json", import.meta.url).href,
  },
];

interface ScenarioPickerProps {
  onPick: (scenario: ScenarioSummary) => void;
  onLive: () => void;
}

export default function ScenarioPicker({ onPick, onLive }: ScenarioPickerProps) {
  const [selectedId, setSelectedId] = useState<string | "live">("live");

  return (
    <div>
      <div
        className="text-label font-medium tracking-[0.15em] uppercase mb-1.5"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        Quick Start
      </div>
      <select
        value={selectedId}
        onChange={(e) => {
          const id = e.target.value;
          setSelectedId(id);
          if (id === "live") {
            onLive();
          } else {
            const s = SCENARIOS.find((sc) => sc.id === id);
            if (s) onPick(s);
          }
        }}
        className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-amber-500/40"
      >
        <option value="live">Run a new simulation (live)</option>
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {selectedId !== "live" && (
        <p className="text-micro text-gray-500 mt-1.5">
          {SCENARIOS.find((s) => s.id === selectedId)?.description}
        </p>
      )}
    </div>
  );
}
