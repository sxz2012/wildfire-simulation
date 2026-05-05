import { useMemo, useRef, useEffect, useState } from "react";
import type { HistoricalFire } from "../data/historicalFires";
import { useCountUp } from "../hooks/useCountUp";
import EmissionsDetailModal from "./EmissionsDetailModal";

const HOTSPOT_AREA_HA = 14;
const CO2_PER_HA = 15;
const PM25_PER_HA = 0.4;
const CO_PER_HA = 1.2;

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

function formatArea(hectares: number): string {
  if (hectares >= 10_000) return formatNumber(hectares / 100) + " km²";
  return formatNumber(hectares) + " ha";
}

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

  return <canvas ref={canvasRef} style={{ width, height }} className="block" />;
}

interface ImpactSectionProps {
  fire: HistoricalFire;
  currentFrame: number;
}

export default function ImpactSection({ fire, currentFrame }: ImpactSectionProps) {
  const stats = useMemo(() => {
    const dailyHotspots: number[] = [];
    let cumulativeHotspots = 0;
    for (const frame of fire.frames) {
      cumulativeHotspots += frame.hotspots.length;
      dailyHotspots.push(frame.hotspots.length);
    }
    return { dailyHotspots, totalHotspots: cumulativeHotspots };
  }, [fire]);

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
  const carsEquivalent = Math.round(co2Tonnes / 4.6);

  const animatedArea = useCountUp(areaBurnedHa);
  const animatedHotspots = useCountUp(hotspotsToDate);
  const animatedCO2 = useCountUp(co2Tonnes);
  const animatedPM25 = useCountUp(pm25Tonnes);
  const animatedCO = useCountUp(coTonnes);
  const animatedCars = useCountUp(carsEquivalent);

  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div
        className="text-caption font-bold tracking-[0.2em] uppercase"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--fire-amber)" }}
      >
        Environmental Impact
      </div>

      {/* Area Burned */}
      <div>
        <div
          className="text-label font-medium tracking-[0.15em] uppercase mb-0.5"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
        >
          Area Burned
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className="text-xl font-bold"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--fire-amber)" }}
          >
            {formatArea(animatedArea)}
          </span>
          <span className="text-caption text-gray-500">{formatNumber(animatedHotspots)} detections</span>
        </div>
      </div>

      {/* Daily Fire Activity */}
      <div>
        <div
          className="text-label font-medium tracking-[0.15em] uppercase mb-1.5"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
        >
          Daily Fire Activity
        </div>
        <BarChart data={stats.dailyHotspots} highlightIdx={currentFrame} color="#F59E0B" />
      </div>

      {/* Emissions — click for breakdown */}
      <button
        type="button"
        onClick={() => setShowDetail(true)}
        className="w-full text-left border-t border-white/[0.04] pt-3 space-y-2 group cursor-pointer
          rounded-md hover:bg-white/[0.02] -mx-2 px-2 transition-colors duration-150"
        title="Click for detailed emissions breakdown"
      >
        <div
          className="text-label font-medium tracking-[0.15em] uppercase mb-1 flex items-center justify-between"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
        >
          <span>Estimated Emissions</span>
          <span
            className="text-micro normal-case tracking-normal opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: "var(--fire-amber)" }}
          >
            details →
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <EmissionCard label="CO₂" value={formatNumber(animatedCO2)} unit="tonnes" color="#EF4444" />
          <EmissionCard label="PM2.5" value={formatNumber(animatedPM25)} unit="tonnes" color="#F97316" />
          <EmissionCard label="CO" value={formatNumber(animatedCO)} unit="tonnes" color="#FBBF24" />
          <EmissionCard label="Car Years" value={formatNumber(animatedCars)} unit="equivalent" color="#A78BFA" />
        </div>
      </button>

      <EmissionsDetailModal
        open={showDetail}
        onClose={() => setShowDetail(false)}
        areaBurnedHa={areaBurnedHa}
        detections={hotspotsToDate}
        co2Tonnes={co2Tonnes}
        pm25Tonnes={pm25Tonnes}
        coTonnes={coTonnes}
        carYears={carsEquivalent}
      />

      {/* Progress Bar */}
      <div>
        <div className="flex justify-between items-baseline mb-1">
          <span
            className="text-label font-medium tracking-wider uppercase"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
          >
            CO₂ vs Total
          </span>
          <span
            className="text-caption tabular-nums"
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

      {/* Source */}
      <p
        className="text-micro pt-1"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-dim)" }}
      >
        Estimates based on VIIRS 375m pixel area &times; published emission factors (van der Werf et al.)
      </p>
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
          className="text-label font-medium tracking-wider uppercase"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--text-secondary)" }}
        >
          {label}
        </span>
      </div>
      <div className="text-base font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", color }}>
        {value}
      </div>
      <div className="text-micro text-gray-600">{unit}</div>
    </div>
  );
}
