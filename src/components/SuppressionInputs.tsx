import { useState } from "react";
import {
  ResourceType,
  RESOURCE_RATES,
  SUPPRESSION_BUNDLES,
  BUNDLE_DISPLAY_LABELS,
  type ResourceCount,
} from "../simulation/types";
import { totalChainsPerHour, chainsToMeters } from "../simulation/suppression";

interface SuppressionInputsProps {
  responseDelayMin: number;
  resources: ResourceCount[];
  onChange: (delay: number, resources: ResourceCount[]) => void;
  nearbyResources?: { stationCount: number; radiusKm: number; suggestedBundle: string };
}

export default function SuppressionInputs({
  responseDelayMin,
  resources,
  onChange,
  nearbyResources,
}: SuppressionInputsProps) {
  const [bundleKey, setBundleKey] = useState<string>("initialAttack");
  const [showCustom, setShowCustom] = useState(false);

  const selectBundle = (key: string) => {
    setBundleKey(key);
    if (key !== "custom") {
      const preset = SUPPRESSION_BUNDLES[key];
      if (preset) {
        onChange(responseDelayMin, [...preset]);
      }
      setShowCustom(false);
    } else {
      setShowCustom(true);
    }
  };

  const updateResource = (type: ResourceType, count: number) => {
    const next = resources.filter((r) => r.type !== type);
    if (count > 0) next.push({ type, count });
    onChange(responseDelayMin, next);
  };

  const wildfireOnly = resources.length === 0;

  const setWildfireOnly = (only: boolean) => {
    if (only) {
      onChange(responseDelayMin, []);
    } else {
      // Restore the Initial Attack default when toggling back on.
      onChange(responseDelayMin, [...SUPPRESSION_BUNDLES.initialAttack]);
      setBundleKey("initialAttack");
      setShowCustom(false);
    }
  };

  const chainsHr = totalChainsPerHour(resources);
  const lineMetersHr = chainsToMeters(chainsHr);

  return (
    <div>
      <div
        className="text-label font-medium tracking-[0.15em] uppercase mb-1.5"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        Suppression Response
      </div>

      {/* Mode toggle: Wildfire only vs With suppression */}
      <div className="flex bg-white/5 rounded-lg p-0.5 mb-3">
        <button
          type="button"
          onClick={() => setWildfireOnly(true)}
          className={`flex-1 py-1.5 rounded-md text-label font-semibold tracking-wide uppercase transition-all duration-200 cursor-pointer ${
            wildfireOnly ? "bg-amber-500/15 text-amber-400" : "text-gray-500 hover:text-gray-300"
          }`}
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          Wildfire Only
        </button>
        <button
          type="button"
          onClick={() => setWildfireOnly(false)}
          className={`flex-1 py-1.5 rounded-md text-label font-semibold tracking-wide uppercase transition-all duration-200 cursor-pointer ${
            !wildfireOnly ? "bg-amber-500/15 text-amber-400" : "text-gray-500 hover:text-gray-300"
          }`}
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          With Suppression
        </button>
      </div>

      {wildfireOnly ? (
        <div className="text-sm text-gray-400 leading-relaxed">
          Live wildfire only — no fire department response. Single-pass run, no
          counterfactual ghost overlay.
        </div>
      ) : (
        <>
          {/* Response delay slider */}
          <div className="mb-3">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-micro text-gray-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                Response delay
              </span>
              <span className="text-sm text-amber-400 tabular-nums" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {responseDelayMin} min
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={180}
              step={5}
              value={responseDelayMin}
              onChange={(e) => onChange(parseInt(e.target.value, 10), resources)}
              className="w-full accent-amber-500"
            />
          </div>

          {/* Bundle selector */}
          <div className="mb-2">
            <select
              value={bundleKey}
              onChange={(e) => selectBundle(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5
                text-sm text-gray-200 outline-none focus:border-amber-500/40"
            >
              {Object.keys(SUPPRESSION_BUNDLES)
                .filter((k) => k !== "none") // "Wildfire Only" toggle replaces the None option here
                .map((key) => (
                  <option key={key} value={key}>{BUNDLE_DISPLAY_LABELS[key] ?? key}</option>
                ))}
              <option value="custom">Custom...</option>
            </select>
          </div>

          {nearbyResources && (
            <div className="text-micro text-gray-500 mb-2 leading-relaxed">
              <span className="text-amber-400/80">{nearbyResources.stationCount}</span> fire
              {" "}stations within {nearbyResources.radiusKm} km of ignition.
              {" "}Suggests <span className="text-amber-400/80">
                {BUNDLE_DISPLAY_LABELS[nearbyResources.suggestedBundle]?.split(" — ")[0] ?? nearbyResources.suggestedBundle}
              </span>.{" "}
              <button
                type="button"
                onClick={() => {
                  const preset = SUPPRESSION_BUNDLES[nearbyResources.suggestedBundle];
                  if (preset) {
                    onChange(responseDelayMin, [...preset]);
                    setBundleKey(nearbyResources.suggestedBundle);
                  }
                }}
                className="text-amber-400 hover:text-amber-300 underline cursor-pointer"
              >
                Apply
              </button>
            </div>
          )}

          {/* Custom roster (when shown) */}
          {showCustom && (
            <div className="space-y-1.5 pl-2 border-l border-amber-500/20 mb-3">
              {Object.values(ResourceType).map((rt) => {
                const cur = resources.find((r) => r.type === rt)?.count ?? 0;
                const meta = RESOURCE_RATES[rt];
                return (
                  <div key={rt} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">
                      {meta.label}
                      <span className="text-micro text-gray-500 ml-1">
                        ({meta.chainsPerHour > 0 ? `${meta.chainsPerHour} ch/hr` : "aerial"})
                      </span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={cur}
                      onChange={(e) => updateResource(rt, Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="w-12 bg-white/[0.04] border border-white/[0.06] rounded text-center
                        text-sm text-gray-200 outline-none focus:border-amber-500/40"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Estimated production readout */}
          <div className="text-micro text-gray-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            Estimated production: {chainsHr} chains/hr ({Math.round(lineMetersHr)} m/hr)
          </div>
        </>
      )}
    </div>
  );
}
