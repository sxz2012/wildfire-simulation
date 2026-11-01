import type { ReactElement } from "react";
import type { Report } from "../simulation/robot/worlds";

export const READINGS_TITLE = "Dog readings (simulated) — measured vs forecast";

function Row({ label, measured, assumed }: { label: string; measured: string; assumed?: string }): ReactElement {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-400">{label}</span>
      <span className="tabular-nums">
        <b className="text-sky-200">{measured}</b>
        {assumed && <span className="text-gray-500"> ({assumed})</span>}
      </span>
    </div>
  );
}

/** Pops up when the dog reports: what it measured next to what the forecast had assumed. */
export default function ReadingsCard({ report }: { report: Report }): ReactElement {
  const { measured: m, assumed: a, edgeOffsetM: d } = report;
  const edge = d === 0 ? "as forecast" : `${Math.abs(d)} m ${d > 0 ? "closer" : "farther"}`;
  return (
    <div
      className="fire-panel rounded-lg p-3 w-[300px] text-sm border border-sky-500/60"
      data-testid="readings-card"
    >
      <div className="text-label font-medium tracking-[0.1em] uppercase text-sky-300 mb-2">📡 {READINGS_TITLE}</div>
      <div className="space-y-1 text-gray-200">
        <Row
          label="Wind"
          measured={`${Math.round(m.windDirection)}° ${Math.round(m.windSpeed)} km/h`}
          assumed={`${Math.round(a.windDirection)}° ${Math.round(a.windSpeed)}`}
        />
        <Row label="Temp" measured={`${Math.round(m.tempC)} °C`} assumed={`${Math.round(a.tempC)}`} />
        <Row label="Humidity" measured={`${Math.round(m.humidity)} %`} assumed={`${Math.round(a.humidity)}`} />
        <Row label="Fire edge" measured={edge} />
      </div>
      <div className="mt-2 pt-2 border-t border-white/[0.08] text-base font-semibold text-white tabular-nums">
        Forecast match {report.matchBefore}% → <span className="text-emerald-300">{report.matchAfter}%</span>
      </div>
    </div>
  );
}
