import { useEffect } from "react";

interface EmissionsDetailModalProps {
  open: boolean;
  onClose: () => void;
  areaBurnedHa: number;
  detections: number;
  co2Tonnes: number;
  pm25Tonnes: number;
  coTonnes: number;
  carYears: number;
}

const CO2_PER_HA = 15;
const PM25_PER_HA = 0.4;
const CO_PER_HA = 1.2;
const CO2_PER_CAR_YEAR = 4.6; // tonnes — typical US passenger car
const TREE_CO2_PER_YEAR = 0.022; // tonnes — typical mature tree absorbs ~22 kg CO2/year

function fmt(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

function fmtArea(ha: number): string {
  if (ha >= 10_000) return (ha / 100).toFixed(1) + " km²";
  return ha.toFixed(0) + " ha";
}

export default function EmissionsDetailModal({
  open,
  onClose,
  areaBurnedHa,
  detections,
  co2Tonnes,
  pm25Tonnes,
  coTonnes,
  carYears,
}: EmissionsDetailModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const treesNeeded = co2Tonnes / TREE_CO2_PER_YEAR;
  const co2Pct = (co2Tonnes / 37_000_000_000) * 100; // % of global annual CO2 (~37 Gt)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
      style={{
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div
        className="fire-panel max-w-2xl w-[min(92vw,720px)] max-h-[88vh] overflow-y-auto rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between sticky top-0 backdrop-blur-md bg-black/40 z-10">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
              <h2
                className="text-caption font-bold tracking-[0.2em] uppercase"
                style={{ color: "var(--fire-amber)" }}
              >
                Emissions Breakdown
              </h2>
            </div>
            <div className="mt-1 text-sm text-gray-400">
              {fmtArea(areaBurnedHa)} burned · {fmt(detections)} detections
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl leading-none px-2 py-1 rounded
              hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <EmissionDetailCard
            label="CO₂"
            color="#EF4444"
            valueLabel={`${fmt(co2Tonnes)} tonnes`}
            formula={`${fmtArea(areaBurnedHa)} × ${CO2_PER_HA} t CO₂/ha`}
            description="Carbon dioxide released into the atmosphere by combustion of woody and herbaceous biomass."
            equivalents={[
              { lhs: "Cars driven for one year", rhs: `${fmt(carYears)}` },
              { lhs: "Mature trees needed to reabsorb (1 yr)", rhs: `${fmt(treesNeeded)}` },
              {
                lhs: "Share of global annual CO₂ emissions (~37 Gt)",
                rhs: `${co2Pct.toFixed(co2Pct < 0.01 ? 4 : 3)}%`,
              },
            ]}
          />

          <EmissionDetailCard
            label="PM2.5"
            color="#F97316"
            valueLabel={`${fmt(pm25Tonnes)} tonnes`}
            formula={`${fmtArea(areaBurnedHa)} × ${PM25_PER_HA} t PM2.5/ha`}
            description="Fine particulates ≤2.5 µm — penetrate deep into lungs and bloodstream. Wildfires are a leading PM2.5 source in many regions."
            equivalents={[
              {
                lhs: "Days of clean-air budget for a typical city",
                rhs: `~${fmt(pm25Tonnes / 0.05)}`,
              },
              {
                lhs: "Equivalent to NYC daily PM2.5 emissions",
                rhs: `~${fmt(pm25Tonnes / 25)}× one day`,
              },
            ]}
          />

          <EmissionDetailCard
            label="CO"
            color="#FBBF24"
            valueLabel={`${fmt(coTonnes)} tonnes`}
            formula={`${fmtArea(areaBurnedHa)} × ${CO_PER_HA} t CO/ha`}
            description="Carbon monoxide — colorless, odorless, toxic. Indicates incomplete combustion in low-oxygen smoldering combustion phase."
            equivalents={[
              {
                lhs: "Equivalent to global vehicle fleet output",
                rhs: `~${(coTonnes / 70_000).toFixed(2)} hours`,
              },
            ]}
          />

          <EmissionDetailCard
            label="Car Years Equivalent"
            color="#A78BFA"
            valueLabel={`${fmt(carYears)}`}
            formula={`Total CO₂ / ${CO2_PER_CAR_YEAR} t per car-year (US average)`}
            description="How many average passenger cars would have to drive for one year to emit the same amount of CO₂ as this fire."
            equivalents={[]}
          />

          {/* Methodology */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 mt-2">
            <div
              className="text-label font-bold tracking-[0.18em] uppercase mb-2"
              style={{ color: "var(--text-secondary)" }}
            >
              Methodology
            </div>
            <ul className="text-sm text-gray-300 space-y-1.5 list-disc pl-5">
              <li>
                Burned area derived from VIIRS 375 m active-fire detections × ~14 ha per
                pixel.
              </li>
              <li>
                Emission factors are weighted averages across fuel types (forest, shrub,
                grass) — see van der Werf et al. (2017).
              </li>
              <li>
                Real fires vary widely with fuel moisture, intensity, and combustion
                completeness — these are first-order estimates.
              </li>
              <li>Car-year baseline: 4.6 t CO₂/year (EPA, US passenger car average).</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmissionDetailCard({
  label,
  color,
  valueLabel,
  formula,
  description,
  equivalents,
}: {
  label: string;
  color: string;
  valueLabel: string;
  formula: string;
  description: string;
  equivalents: Array<{ lhs: string; rhs: string }>;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}66` }}
          />
          <span
            className="text-label font-bold tracking-[0.18em] uppercase"
            style={{ color: "var(--text-secondary)" }}
          >
            {label}
          </span>
        </div>
        <span className="text-xl font-bold tabular-nums" style={{ color }}>
          {valueLabel}
        </span>
      </div>

      <div className="text-micro text-gray-500 mb-2 tabular-nums">
        formula: {formula}
      </div>

      <p className="text-sm text-gray-300 leading-relaxed mb-3">{description}</p>

      {equivalents.length > 0 && (
        <div className="space-y-1.5">
          {equivalents.map((eq, i) => (
            <div
              key={i}
              className="flex justify-between items-baseline text-sm border-t border-white/[0.04] pt-1.5"
            >
              <span className="text-gray-400">{eq.lhs}</span>
              <span className="text-gray-200 font-bold tabular-nums">{eq.rhs}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
