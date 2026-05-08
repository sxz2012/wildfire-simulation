import { useEffect, useState } from "react";
import type { ReactElement } from "react";

interface Props {
  src: string;
  alt: string;
  /** Class applied to the inline <img>. */
  className?: string;
}

/**
 * Inline image that opens a full-screen lightbox on click. Used for the
 * info-modal diagrams so demo viewers can read the baked-in labels at full
 * resolution. Esc / click-outside dismisses; the Esc handler runs in the
 * capture phase so it closes the lightbox without also closing the parent
 * InfoModal.
 */
export default function ZoomableImage({
  src,
  alt,
  className = "",
}: Props): ReactElement {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setZoomed(false);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [zoomed]);

  return (
    <>
      <img
        src={src}
        alt={alt}
        className={`cursor-zoom-in ${className}`}
        loading="lazy"
        onClick={(e) => {
          e.stopPropagation();
          setZoomed(true);
        }}
      />
      {zoomed && (
        <div
          className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center cursor-zoom-out animate-fade-in"
          style={{
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            animation: "lightboxFade 180ms ease-out",
          }}
          onClick={() => setZoomed(false)}
        >
          <img
            src={src}
            alt={alt}
            className="max-w-[96vw] max-h-[96vh] object-contain rounded-lg shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Close"
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/[0.08] text-gray-200 hover:bg-white/[0.15] hover:text-white text-2xl leading-none transition-colors"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            ×
          </button>
          <span
            className="absolute bottom-4 left-1/2 -translate-x-1/2 text-caption tracking-[0.2em] uppercase text-gray-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            Esc · click anywhere to close
          </span>
          <style>{`
            @keyframes lightboxFade {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </>
  );
}
