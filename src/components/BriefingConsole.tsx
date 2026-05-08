import type { ReactElement } from "react";
import { useInfoModal } from "../info/InfoContext";
import type { InfoModalId } from "../info/types";

interface BriefingEntry {
  id: InfoModalId | "resources";
  icon: string;
  label: string;
  hint: string;
}

const ENTRIES: BriefingEntry[] = [
  { id: "predictionModel", icon: "🔮", label: "Prediction", hint: "How the model works" },
  { id: "firePhysics", icon: "🌲", label: "Fire Physics", hint: "Wind · Slope · Fuel" },
  { id: "suppression", icon: "🛡️", label: "Suppression", hint: "Stopping the fire" },
  { id: "resources", icon: "📚", label: "Resources", hint: "Vehicles · Costs · Photos" },
];

interface BriefingConsoleProps {
  onOpenResources: () => void;
  isResourcesActive: boolean;
}

const MONO = { fontFamily: "'JetBrains Mono', monospace" } as const;

export default function BriefingConsole({
  onOpenResources,
  isResourcesActive,
}: BriefingConsoleProps): ReactElement {
  const { active, open } = useInfoModal();

  const handleClick = (entry: BriefingEntry) => {
    if (entry.id === "resources") onOpenResources();
    else open(entry.id);
  };

  return (
    <aside
      className="fixed bottom-3 right-3 z-50 select-none briefing-enter"
      style={MONO}
    >
      <div className="briefing-console relative w-[244px] overflow-hidden rounded-xl">
        {/* Top hairline accent — fades to transparent on both ends */}
        <span className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />

        {/* Header */}
        <header className="px-4 pt-3.5 pb-2.5 border-b border-white/[0.05]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* LED pip — slow pulse, no bounce */}
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-amber-400 opacity-70 animate-pulse" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.65)]" />
              </span>
              <span className="text-[10px] tracking-[0.3em] uppercase text-amber-400 font-semibold">
                Briefing
              </span>
            </div>
            <span
              className="text-[9px] tracking-[0.2em] uppercase text-gray-600 tabular-nums"
            >
              04 · ch
            </span>
          </div>
          <p className="text-[10px] text-gray-500 mt-1.5 leading-tight">
            Tap a topic to learn more
          </p>
        </header>

        {/* Entries */}
        <ul className="py-1">
          {ENTRIES.map((entry, i) => {
            const isActive =
              entry.id === "resources" ? isResourcesActive : active === entry.id;
            return (
              <li key={entry.id} className="briefing-row" style={{ animationDelay: `${80 + i * 55}ms` }}>
                <button
                  type="button"
                  onClick={() => handleClick(entry)}
                  className={`group relative w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 ${
                    isActive ? "bg-amber-500/[0.12]" : "hover:bg-amber-500/[0.07]"
                  }`}
                >
                  {/* Left accent rail */}
                  <span
                    className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r transition-all duration-200 ${
                      isActive
                        ? "bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.6)]"
                        : "bg-transparent group-hover:bg-amber-400/45"
                    }`}
                  />

                  {/* Icon — slight tilt-shift on hover */}
                  <span
                    className="text-[18px] flex-shrink-0 leading-none transition-transform duration-200 group-hover:scale-110"
                    aria-hidden="true"
                  >
                    {entry.icon}
                  </span>

                  {/* Label + hint */}
                  <span className="flex-1 min-w-0">
                    <span
                      className={`block text-[11px] tracking-[0.22em] uppercase font-semibold leading-snug transition-colors ${
                        isActive
                          ? "text-amber-300"
                          : "text-amber-400/95 group-hover:text-amber-300"
                      }`}
                    >
                      {entry.label}
                    </span>
                    <span className="block text-[10px] text-gray-500 mt-0.5 leading-tight">
                      {entry.hint}
                    </span>
                  </span>

                  {/* Chevron — slides in on hover/active */}
                  <span
                    className={`text-[14px] leading-none flex-shrink-0 transition-all duration-200 ${
                      isActive
                        ? "text-amber-300 translate-x-0 opacity-100"
                        : "text-amber-400/45 -translate-x-1.5 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                    }`}
                  >
                    ›
                  </span>
                </button>

                {/* Inset hairline between rows (skip after last) */}
                {i < ENTRIES.length - 1 && (
                  <span className="block mx-4 h-px bg-white/[0.04]" />
                )}
              </li>
            );
          })}
        </ul>

        {/* Bottom corner stencils — subtle tactical detail */}
        <span className="pointer-events-none absolute bottom-1.5 left-2 text-[8px] tracking-[0.25em] text-amber-400/25">
          ◆
        </span>
        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[8px] tracking-[0.25em] text-amber-400/25">
          ◆
        </span>
      </div>

      {/* Component-scoped animations */}
      <style>{`
        .briefing-console {
          background: linear-gradient(180deg, rgba(18,18,22,0.92) 0%, rgba(10,10,14,0.92) 100%);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(255,255,255,0.07);
          box-shadow:
            0 18px 38px -14px rgba(0,0,0,0.75),
            0 0 0 1px rgba(245,158,11,0.04),
            inset 0 1px 0 rgba(255,255,255,0.04);
        }

        @keyframes briefing-pop {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        .briefing-enter {
          animation: briefing-pop 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        @keyframes briefing-row-in {
          from { opacity: 0; transform: translateX(8px); }
          to   { opacity: 1; transform: translateX(0);   }
        }
        .briefing-row {
          opacity: 0;
          animation: briefing-row-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      `}</style>
    </aside>
  );
}
