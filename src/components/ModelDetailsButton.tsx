import type { ReactElement } from "react";

interface ModelDetailsButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

const MONO_FONT = { fontFamily: "'JetBrains Mono', monospace" } as const;

/**
 * Compact trigger pinned to the right edge mid-panel. Hides when the
 * panel is open — the panel has its own × close affordance.
 */
export default function ModelDetailsButton({
  isOpen,
  onClick,
}: ModelDetailsButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open model details"
      aria-hidden={isOpen}
      className={`fixed right-3 top-1/2 -translate-y-1/2 z-50 fire-panel rounded-lg
        px-3 py-2 text-caption tracking-[0.18em] uppercase font-medium
        text-amber-400 hover:bg-amber-500/15 hover:text-amber-300
        transition-all duration-200 cursor-pointer flex items-center gap-2
        ${isOpen ? "opacity-0 pointer-events-none translate-x-2" : "opacity-100"}`}
      style={MONO_FONT}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 4 4 5-5" />
      </svg>
      <span>Model</span>
    </button>
  );
}
