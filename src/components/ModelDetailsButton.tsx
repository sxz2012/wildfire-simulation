import type { ReactElement } from "react";

interface ModelDetailsButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

const MONO_FONT = { fontFamily: "'JetBrains Mono', monospace" } as const;

export default function ModelDetailsButton({
  isOpen,
  onClick,
}: ModelDetailsButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`fixed top-[200px] right-3 z-50 fire-panel rounded-lg
        px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer
        ${
          isOpen
            ? "bg-amber-500/25 text-amber-200 hover:bg-amber-500/30"
            : "text-amber-400 hover:bg-amber-500/15"
        }`}
      style={MONO_FONT}
      title="Show / hide computation model details"
    >
      📊 Model Details
    </button>
  );
}
