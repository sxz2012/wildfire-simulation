import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  DEFAULT_MODEL_CONFIG,
  ModelConfigProvider,
  useModelConfig,
} from "../ModelConfig";

function wrapper({ children }: { children: ReactNode }) {
  return <ModelConfigProvider>{children}</ModelConfigProvider>;
}

describe("ModelConfig context", () => {
  it("exposes defaults with isModified=false", () => {
    const { result } = renderHook(() => useModelConfig(), { wrapper });
    expect(result.current.config).toEqual(DEFAULT_MODEL_CONFIG);
    expect(result.current.isModified).toBe(false);
  });

  it("setConfig updates only the specified field", () => {
    const { result } = renderHook(() => useModelConfig(), { wrapper });
    act(() => {
      result.current.setConfig({ dozerChainsHr: 150 });
    });
    expect(result.current.config.dozerChainsHr).toBe(150);
    expect(result.current.config.crewChainsHr).toBe(DEFAULT_MODEL_CONFIG.crewChainsHr);
    expect(result.current.config.engineChainsHr).toBe(DEFAULT_MODEL_CONFIG.engineChainsHr);
    expect(result.current.config.helitackSwathChains).toBe(DEFAULT_MODEL_CONFIG.helitackSwathChains);
    expect(result.current.config.breachTolerancePct).toBe(DEFAULT_MODEL_CONFIG.breachTolerancePct);
    expect(result.current.config.searchCeilingChainsHr).toBe(DEFAULT_MODEL_CONFIG.searchCeilingChainsHr);
    expect(result.current.config.resumeWindowSteps).toBe(DEFAULT_MODEL_CONFIG.resumeWindowSteps);
    expect(result.current.isModified).toBe(true);
  });

  it("multiple setConfig calls accumulate field changes", () => {
    const { result } = renderHook(() => useModelConfig(), { wrapper });
    act(() => {
      result.current.setConfig({ dozerChainsHr: 150 });
    });
    act(() => {
      result.current.setConfig({ crewChainsHr: 18 });
    });
    expect(result.current.config.dozerChainsHr).toBe(150);
    expect(result.current.config.crewChainsHr).toBe(18);
    expect(result.current.config.engineChainsHr).toBe(DEFAULT_MODEL_CONFIG.engineChainsHr);
  });

  it("resetAll restores defaults and clears isModified", () => {
    const { result } = renderHook(() => useModelConfig(), { wrapper });
    act(() => {
      result.current.setConfig({ dozerChainsHr: 150, crewChainsHr: 18, breachTolerancePct: 5 });
    });
    expect(result.current.isModified).toBe(true);
    act(() => {
      result.current.resetAll();
    });
    expect(result.current.config).toEqual(DEFAULT_MODEL_CONFIG);
    expect(result.current.isModified).toBe(false);
  });

  it("isModified flag tracks state across set, reset, set", () => {
    const { result } = renderHook(() => useModelConfig(), { wrapper });
    expect(result.current.isModified).toBe(false);
    act(() => {
      result.current.setConfig({ dozerChainsHr: 200 });
    });
    expect(result.current.isModified).toBe(true);
    act(() => {
      result.current.resetAll();
    });
    expect(result.current.isModified).toBe(false);
    act(() => {
      result.current.setConfig({ resumeWindowSteps: 60 });
    });
    expect(result.current.isModified).toBe(true);
  });

  it("setConfig back to default value leaves isModified=false", () => {
    const { result } = renderHook(() => useModelConfig(), { wrapper });
    act(() => {
      result.current.setConfig({ dozerChainsHr: DEFAULT_MODEL_CONFIG.dozerChainsHr });
    });
    expect(result.current.isModified).toBe(false);
  });

  it("useModelConfig throws outside a Provider", () => {
    expect(() => renderHook(() => useModelConfig())).toThrow(/ModelConfigProvider/);
  });
});
