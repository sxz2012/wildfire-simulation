import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";

export interface ModelConfig {
  dozerChainsHr: number;
  crewChainsHr: number;
  engineChainsHr: number;
  helitackSwathChains: number;
  breachTolerancePct: number;
  searchCeilingChainsHr: number;
  resumeWindowSteps: number;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  dozerChainsHr: 75,
  crewChainsHr: 9,
  engineChainsHr: 4,
  helitackSwathChains: 8,
  breachTolerancePct: 2,
  searchCeilingChainsHr: 2500,
  resumeWindowSteps: 30,
};

export interface ModelConfigContextValue {
  config: ModelConfig;
  setConfig: (partial: Partial<ModelConfig>) => void;
  resetAll: () => void;
  isModified: boolean;
}

const ModelConfigContext = createContext<ModelConfigContextValue | null>(null);

export function ModelConfigProvider({ children }: { children: ReactNode }): ReactElement {
  const [config, setState] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);

  const setConfig = useCallback((partial: Partial<ModelConfig>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetAll = useCallback(() => {
    setState(DEFAULT_MODEL_CONFIG);
  }, []);

  const isModified = (Object.keys(DEFAULT_MODEL_CONFIG) as Array<keyof ModelConfig>).some(
    (k) => config[k] !== DEFAULT_MODEL_CONFIG[k],
  );

  const value = useMemo(
    () => ({ config, setConfig, resetAll, isModified }),
    [config, setConfig, resetAll, isModified],
  );

  return <ModelConfigContext.Provider value={value}>{children}</ModelConfigContext.Provider>;
}

export function useModelConfig(): ModelConfigContextValue {
  const ctx = useContext(ModelConfigContext);
  if (!ctx) throw new Error("useModelConfig must be used inside <ModelConfigProvider>");
  return ctx;
}
