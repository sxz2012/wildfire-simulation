import type { ReactNode } from "react";
import { BUNDLE_DISPLAY_LABELS } from "../simulation/types";

interface AnalysisPanelProps {
  q1?: {
    bundle: string;
    maxDelayMin: number | null;
  };
  q2?: {
    delayMin: number;
    minTier: string | null;
  };
  thresholdAreaHa: number;
}

export default function AnalysisPanel({ q1, q2, thresholdAreaHa }: AnalysisPanelProps) {
  if (!q1 && !q2) return null;

  return (
    <div className="border-t border-white/[0.04] pt-3 space-y-3">
      <div
        className="text-label font-medium tracking-[0.15em] uppercase mb-1"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        What-If Analysis
      </div>

      {q1 && (
        <Card title="Max delay before suppression fails">
          <div className="text-2xl font-bold text-amber-400 tabular-nums">
            {q1.maxDelayMin === null ? "Cannot contain" : `${q1.maxDelayMin} min`}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            With {BUNDLE_DISPLAY_LABELS[q1.bundle] ?? q1.bundle}
          </div>
          <div className="text-xs text-gray-500">
            Keeping fire ≤ {thresholdAreaHa.toFixed(0)} ha
          </div>
        </Card>
      )}

      {q2 && (
        <Card title="Minimum effective response">
          <div className="text-base font-bold text-amber-400">
            {q2.minTier === null
              ? "Cannot contain"
              : (BUNDLE_DISPLAY_LABELS[q2.minTier] ?? q2.minTier)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            With {q2.delayMin} min response delay
          </div>
          <div className="text-xs text-gray-500">
            Keeping fire ≤ {thresholdAreaHa.toFixed(0)} ha
          </div>
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div
        className="text-micro tracking-wider uppercase mb-1.5"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
