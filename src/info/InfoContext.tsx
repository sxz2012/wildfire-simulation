import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { InfoModalId } from "./types";

interface InfoContextValue {
  active: InfoModalId | null;
  open: (id: InfoModalId) => void;
  close: () => void;
}

const InfoContext = createContext<InfoContextValue | null>(null);

export function InfoModalProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<InfoModalId | null>(null);

  const open = useCallback((id: InfoModalId) => setActive(id), []);
  const close = useCallback(() => setActive(null), []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const value = useMemo(() => ({ active, open, close }), [active, open, close]);

  return <InfoContext.Provider value={value}>{children}</InfoContext.Provider>;
}

export function useInfoModal(): InfoContextValue {
  const ctx = useContext(InfoContext);
  if (!ctx) throw new Error("useInfoModal must be used inside InfoModalProvider");
  return ctx;
}
