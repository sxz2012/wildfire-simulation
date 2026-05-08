import type { ReactElement } from "react";
import { ResourceType } from "../simulation/types";

const MONO = { fontFamily: "'JetBrains Mono', monospace" } as const;

const TOGGLES: { type: ResourceType; emoji: string; label: string; hint: string }[] = [
  { type: ResourceType.Type1Dozer, emoji: "🚜", label: "Dozer",     hint: "Type 1 dozer" },
  { type: ResourceType.Type1Crew,  emoji: "🧯", label: "T1 Crew",   hint: "Type 1 crew (Hotshots)" },
  { type: ResourceType.Type2Crew,  emoji: "👷", label: "T2 Crew",   hint: "Type 2 hand crew" },
  { type: ResourceType.Engine,     emoji: "🚒", label: "Engine",    hint: "Type 3/6 wildland engine" },
  { type: ResourceType.Helitack,   emoji: "🚁", label: "Helitack",  hint: "Type 2 helicopter w/ bucket" },
  { type: ResourceType.AirTanker,  emoji: "✈️", label: "Tanker",    hint: "Large fixed-wing tanker" },
];

interface Props {
  available: ResourceType[];
  onChange: (next: ResourceType[]) => void;
  /** Optional className passed to the outer panel for positioning. */
  className?: string;
}

/**
 * Compact toggle row controlling which resource types the inverse-search
 * solver may include in its recommended roster. Used during the paused-
 * drawing flow, just above the Compute toolbar.
 */
export default function ResourceAvailability({
  available,
  onChange,
  className = "",
}: Props): ReactElement {
  const toggle = (type: ResourceType) => {
    const next = available.includes(type)
      ? available.filter((t) => t !== type)
      : [...available, type];
    onChange(next);
  };

  const allOn = TOGGLES.every((t) => available.includes(t.type));
  const reset = () => onChange(TOGGLES.map((t) => t.type));

  return (
    <div
      className={`fire-panel rounded-xl px-4 py-2.5 flex items-center gap-3 ${className}`}
      style={MONO}
    >
      <span className="text-label uppercase tracking-[0.18em] text-amber-400 whitespace-nowrap">
        Available resources
      </span>

      <div className="flex items-center gap-1.5 flex-wrap">
        {TOGGLES.map((t) => {
          const on = available.includes(t.type);
          return (
            <button
              key={t.type}
              type="button"
              onClick={() => toggle(t.type)}
              className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-caption transition-colors ${
                on
                  ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
                  : "border-white/[0.06] bg-white/[0.02] text-gray-500 hover:text-gray-300"
              }`}
              title={`${t.hint} — click to ${on ? "disable" : "enable"}`}
            >
              <span aria-hidden="true" className={on ? "" : "opacity-60 grayscale"}>
                {t.emoji}
              </span>
              <span className="tracking-[0.1em] uppercase">{t.label}</span>
              <span className={on ? "text-amber-300 text-[10px]" : "text-gray-600 text-[10px]"}>
                {on ? "✓" : "○"}
              </span>
            </button>
          );
        })}
      </div>

      {!allOn && (
        <button
          type="button"
          onClick={reset}
          className="ml-auto text-caption text-gray-500 hover:text-amber-300 transition-colors uppercase tracking-wider"
        >
          Reset all
        </button>
      )}
    </div>
  );
}
