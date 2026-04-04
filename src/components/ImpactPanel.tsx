import { useMemo, useRef, useEffect } from "react";
import type { HistoricalFire } from "../data/historicalFires";

interface ImpactPanelProps {
  fire: HistoricalFire | null;
  currentFrame: number;
  visible: boolean;
}

/**
 * Emission factors (published research averages):
 * - Each VIIRS hotspot ≈ 0.14 km² (375m pixel)
 * - CO2: ~20 tonnes per hectare (forest), ~8 t/ha (grass/shrub)
 * - PM2.5: ~0.5 tonnes per hectare (average across fuel types)
 * - CO: ~1.5 tonnes per hectare
 */
const HOTSPOT_AREA_HA = 14; // ~375m x 375m in hectares
const CO2_PER_HA = 15; // tonnes (weighted average)
const PM25_PER_HA = 0.4; // tonnes
const CO_PER_HA = 1.2; // tonnes

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

function formatArea(hectares: number): string {
  if (hectares >= 10_000) return formatNumber(hectares / 100) + " km²";
  return formatNumber(hectares) + " ha";
}

/** Mini sparkline bar chart drawn on canvas */
function BarChart({
  data,
  highlightIdx,
  color,
  width = 220,
  height = 50,
}: {
  data: number[];
  highlightIdx: number;
  color: string;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const maxVal = Math.max(...data, 1);
    const barWidth = Math.max(1, (width - data.length) / data.length);
    const gap = 1;

    for (let i = 0; i < data.length; i++) {
      const barHeight = (data[i] / maxVal) * (height - 4);
      const x = i * (barWidth + gap);
      const y = height - barHeight - 2;

      if (i <= highlightIdx) {
        ctx.fillStyle = i === highlightIdx ? color : color + "99";
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.08)";
      }

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1);
      ctx.fill();
    }
  }, [data, highlightIdx, color, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="block"
    />
  );
}

export default function ImpactPanel({ fire, currentFrame, visible }: ImpactPanelProps) {
  if (!visible || !fire) return null;

  const stats = useMemo(() => {
    // Compute cumulative stats per frame
    const dailyHotspots: number[] = [];
    let cumulativeHotspots = 0;

    for (const frame of fire.frames) {
      cumulativeHotspots += frame.hotspots.length;
      dailyHotspots.push(frame.hotspots.length);
    }

    return { dailyHotspots, totalHotspots: cumulativeHotspots };
  }, [fire]);

  // Current frame stats
  const hotspotsToDate = useMemo(() => {
    let count = 0;
    for (let i = 0; i <= currentFrame && i < fire.frames.length; i++) {
      count += fire.frames[i].hotspots.length;
    }
    return count;
  }, [fire, currentFrame]);

  const areaBurnedHa = hotspotsToDate * HOTSPOT_AREA_HA;
  const co2Tonnes = areaBurnedHa * CO2_PER_HA;
  const pm25Tonnes = areaBurnedHa * PM25_PER_HA;
  const coTonnes = areaBurnedHa * CO_PER_HA;

  // Equivalent comparisons
  const carsEquivalent = Math.round(co2Tonnes / 4.6); // avg car emits 4.6t CO2/year

  return (
    <div className="fire-panel absolute top-3 left-[340px] z-50 rounded-xl w-[260px] text-white overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-amber-500/10">
        <h3
          className="text-[10px] font-bold tracking-[0.2em] uppercase"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--fire-amber)" }}
        >
          Environmental Impact
        </h3>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Area Burned */}
        <StatRow
          label="Area Burned"
          value={formatArea(areaBurnedHa)}
          sublabel={`${formatNumber(hotspotsToDate)} detections`}
        />

        {/* Daily Fire Activity Chart */}
        <div>
          <div
            className="text-[9px] font-medium tracking-[0.15em] uppercase mb-1.5"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
          >
            Daily Fire Activity
          </div>
          <BarChart
            data={stats.dailyHotspots}
            highlightIdx={currentFrame}
            color="#F59E0B"
          />
        </div>

        {/* Emissions */}
        <div className="border-t border-white/[0.04] pt-3 space-y-2">
          <div
            className="text-[9px] font-medium tracking-[0.15em] uppercase mb-1"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
          >
            Estimated Emissions
          </div>

          <div className="grid grid-cols-2 gap-2">
            <EmissionCard label="CO₂" value={formatNumber(co2Tonnes)} unit="tonnes" color="#EF4444" />
            <EmissionCard label="PM2.5" value={formatNumber(pm25Tonnes)} unit="tonnes" color="#F97316" />
            <EmissionCard label="CO" value={formatNumber(coTonnes)} unit="tonnes" color="#FBBF24" />
            <EmissionCard
              label="Car Years"
              value={formatNumber(carsEquivalent)}
              unit="equivalent"
              color="#A78BFA"
            />
          </div>
        </div>

        {/* CO2 Progress Bar */}
        <div>
          <div className="flex justify-between items-baseline mb-1">
            <span
              className="text-[9px] font-medium tracking-wider uppercase"
              style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
            >
              CO₂ vs Total
            </span>
            <span
              className="text-[10px] tabular-nums"
              style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-secondary)" }}
            >
              {Math.round((hotspotsToDate / Math.max(stats.totalHotspots, 1)) * 100)}%
            </span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${(hotspotsToDate / Math.max(stats.totalHotspots, 1)) * 100}%`,
                background: "linear-gradient(90deg, #F59E0B, #EF4444)",
                boxShadow: "0 0 6px rgba(239, 68, 68, 0.4)",
              }}
            />
          </div>
        </div>

        {/* Source note */}
        <p
          className="text-[8px] pt-1"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
        >
          Estimates based on VIIRS 375m pixel area &times; published emission factors (van der Werf et al.)
        </p>
      </div>
    </div>
  );
}

function StatRow({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div>
      <div
        className="text-[9px] font-medium tracking-[0.15em] uppercase mb-0.5"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-lg font-bold"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--fire-amber)" }}
        >
          {value}
        </span>
        <span className="text-[10px] text-gray-500">{sublabel}</span>
      </div>
    </div>
  );
}

function EmissionCard({ label, value, unit, color }: {
  label: string; value: string; unit: string; color: string;
}) {
  return (
    <div className="bg-white/[0.03] rounded-lg px-2.5 py-2 border border-white/[0.04]">
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}40` }} />
        <span
          className="text-[9px] font-medium tracking-wider uppercase"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-secondary)" }}
        >
          {label}
        </span>
      </div>
      <div
        className="text-sm font-bold"
        style={{ fontFamily: "'JetBrains Mono', monospace", color }}
      >
        {value}
      </div>
      <div className="text-[8px] text-gray-600">{unit}</div>
    </div>
  );
}
