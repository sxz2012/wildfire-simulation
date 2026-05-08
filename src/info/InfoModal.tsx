import type { ReactElement } from "react";
import { useInfoModal } from "./InfoContext";
import type { InfoModalContent, InfoModalId } from "./types";
import { predictionModelContent } from "./content/predictionModel";
import { firePhysicsContent } from "./content/firePhysics";
import { suppressionContent } from "./content/suppression";

const MONO_FONT = { fontFamily: "'JetBrains Mono', monospace" } as const;
const SANS_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

const REGISTRY: Record<InfoModalId, InfoModalContent> = {
  predictionModel: predictionModelContent,
  firePhysics: firePhysicsContent,
  suppression: suppressionContent,
};

export default function InfoModal(): ReactElement | null {
  const { active, close } = useInfoModal();
  if (!active) return null;

  const content = REGISTRY[active];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        ...SANS_FONT,
      }}
      onClick={close}
    >
      <div
        className="fire-panel rounded-2xl text-white max-h-[96vh] w-[min(1280px,96vw)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]"
          style={MONO_FONT}
        >
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden="true">{content.icon}</span>
            <div>
              <h2 className="text-xl tracking-[0.2em] uppercase text-amber-400 font-bold leading-tight">
                {content.title}
              </h2>
              {content.subtitle && (
                <p className="text-caption text-gray-400 mt-0.5">{content.subtitle}</p>
              )}
            </div>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="text-gray-400 hover:text-amber-200 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-white/[0.04] transition-colors"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5 space-y-6 text-base leading-relaxed">
          {content.body}
        </div>

        {content.sources && (
          <footer
            className="border-t border-white/[0.06] px-6 py-3 text-caption text-gray-500 leading-relaxed"
            style={MONO_FONT}
          >
            {content.sources}
          </footer>
        )}
      </div>
    </div>
  );
}
