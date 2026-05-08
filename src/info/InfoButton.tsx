import type { ReactElement } from "react";
import { useInfoModal } from "./InfoContext";
import type { InfoModalId } from "./types";

interface InfoButtonProps {
  modal: InfoModalId;
  /** Display variant. "icon" = compact ⓘ chip; "labeled" = pill with emoji + text. */
  variant?: "icon" | "labeled";
  icon?: string;
  label?: string;
  title?: string;
  className?: string;
}

/**
 * Trigger that opens an InfoModal. The icon variant is intended for inline
 * placement next to a related UI element; the labeled variant is intended
 * for the floating help cluster anchored bottom-right.
 */
export default function InfoButton({
  modal,
  variant = "icon",
  icon,
  label,
  title,
  className = "",
}: InfoButtonProps): ReactElement {
  const { open } = useInfoModal();

  if (variant === "labeled") {
    return (
      <button
        type="button"
        onClick={() => open(modal)}
        title={title ?? label}
        className={
          "fire-panel rounded-lg px-3 py-2 text-caption tracking-[0.18em] uppercase " +
          "font-medium text-amber-400 hover:bg-amber-500/15 hover:text-amber-300 " +
          "transition-colors cursor-pointer flex items-center gap-2 " +
          "shadow-[0_4px_16px_-4px_rgba(0,0,0,0.5)] " + className
        }
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {icon && <span aria-hidden="true">{icon}</span>}
        {label && <span>{label}</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open(modal);
      }}
      title={title ?? label ?? "Learn more"}
      aria-label={title ?? label ?? "Learn more"}
      className={
        "inline-flex items-center justify-center w-5 h-5 rounded-full " +
        "border border-amber-400/40 text-amber-400/80 hover:text-amber-300 " +
        "hover:border-amber-400 hover:bg-amber-500/10 transition-colors " +
        "text-[11px] font-bold cursor-pointer " + className
      }
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
    >
      ⓘ
    </button>
  );
}
