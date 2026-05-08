import type { InfoModalContent } from "../types";

const MONO = { fontFamily: "'JetBrains Mono', monospace" } as const;

export const predictionModelContent: InfoModalContent = {
  id: "predictionModel",
  icon: "🔮",
  title: "How we predict the fire",
  subtitle: "Real terrain & weather → physics + machine learning → cell-by-cell prediction",
  body: (
    <>
      {/* The 3-step diagram */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Step
          n={1}
          title="Real-world inputs"
          summary="Terrain, vegetation, and live weather pulled from public datasets."
          details={[
            "Elevation: Cesium World Terrain (1–30 m)",
            "Land cover: ESA WorldCover 10 m (water, forest, shrub, grass)",
            "Weather: Open-Meteo (live or historical wind, humidity, temperature)",
          ]}
        />
        <Step
          n={2}
          title="Physics + ML"
          summary="A Rothermel-style spread equation, then a trained model fine-tunes the rate."
          details={[
            "Base rate set by the fuel type (grass/shrub/forest)",
            "Wind alignment and uphill slope multiply the rate",
            "Humidity slows it",
            "An XGBoost model learns the residual from real fires",
          ]}
        />
        <Step
          n={3}
          title="Per-cell prediction"
          summary="Every 50 m × 50 m cell decides each timestep whether it ignites."
          details={[
            "Grid: up to 600 × 600 cells (≈ 30 km × 30 km)",
            "Step: 15 sim-minutes by default",
            "State per cell: unburned · burning · burned · suppressed",
          ]}
        />
      </section>

      {/* The kid version + firefighter version of the formula */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h3 className="text-amber-400 text-lg mb-3 tracking-[0.15em] uppercase" style={MONO}>
          The spread equation
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <p className="text-caption uppercase text-gray-400 mb-1.5" style={MONO}>
              Kid version
            </p>
            <p className="text-lg text-amber-200 leading-snug">
              <strong>fuel × wind-push × uphill-push × dryness</strong>
            </p>
            <p className="text-sm text-gray-400 mt-2">
              How fast a square of land burns depends on what's on it,
              how hard the wind is blowing, whether the ground tilts up,
              and how dry the air is.
            </p>
          </div>
          <div>
            <p className="text-caption uppercase text-gray-400 mb-1.5" style={MONO}>
              Firefighter version
            </p>
            <p className="text-lg text-amber-200 tabular-nums" style={MONO}>
              R = R₀ · (1 + φ<sub>wind</sub> + φ<sub>slope</sub>) · f<sub>humidity</sub>
            </p>
            <p className="text-sm text-gray-400 mt-2">
              Surface rate of spread (m/min). R₀ is the no-wind, no-slope
              base rate per fuel model; φ-terms are the Rothermel multipliers;
              f<sub>humidity</sub> down-weights at higher RH.
            </p>
          </div>
        </div>
      </section>

      {/* The ML side */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h3 className="text-amber-400 text-lg mb-3 tracking-[0.15em] uppercase" style={MONO}>
          How the model was trained
        </h3>
        <div className="space-y-3 text-gray-300">
          <p>
            The base equation is over fifty years old (Rothermel, 1972). It works,
            but it under-predicts in some terrains and over-predicts in others.
            Instead of hand-tuning constants per region, we let an XGBoost
            gradient-boosted tree learn the corrections from real fires.
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-sm">
            <li>
              <span className="text-amber-300">Training labels:</span> day-by-day
              fire perimeters from <strong>NASA FIRMS</strong> hotspot detections.
            </li>
            <li>
              <span className="text-amber-300">Calibration fires:</span> Marshall
              (CO 2021), Lahaina (HI 2023), Caldor (CA 2021), Thomas (CA 2017),
              Woolsey (CA 2018).
            </li>
            <li>
              <span className="text-amber-300">Features:</span> wind speed &
              direction, humidity, fuel class, slope, aspect, elevation,
              temperature, time-of-day, recent precipitation.
            </li>
            <li>
              <span className="text-amber-300">Validation target:</span> realistic
              spread rates per fuel — Grass 11–14 km/day, Shrub 5–7 km/day,
              Forest 1–3 km/day.
            </li>
          </ul>
        </div>
      </section>

      {/* Honesty section */}
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-5">
        <h3 className="text-amber-300 text-lg mb-3 tracking-[0.15em] uppercase" style={MONO}>
          What this model does <em>not</em> do
        </h3>
        <ul className="list-disc list-inside space-y-1.5 text-gray-200">
          <li>
            <strong>Spotting / ember cast.</strong> Real fires throw embers
            kilometers ahead. Not modeled.
          </li>
          <li>
            <strong>Crown fire.</strong> Surface-only. Tree-canopy ignition
            and torching are not captured.
          </li>
          <li>
            <strong>Detailed fuel moisture.</strong> 1-hr / 10-hr / 100-hr
            timelag fuels are collapsed into a single humidity factor.
          </li>
          <li>
            <strong>Structure ignition.</strong> Buildings are treated as
            terrain, not as ignitable fuel.
          </li>
        </ul>
        <p className="text-caption text-amber-300/80 mt-3" style={MONO}>
          This is a teaching tool, not an operational forecast.
        </p>
      </section>
    </>
  ),
  sources: (
    <>
      Rothermel (1972) USDA INT-115 · Albini (1976) USDA · NASA FIRMS · ESA WorldCover · Open-Meteo · XGBoost
    </>
  ),
};

function Step({
  n,
  title,
  summary,
  details,
}: {
  n: number;
  title: string;
  summary: string;
  details: string[];
}) {
  return (
    <article className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col">
      <div className="flex items-baseline gap-3 mb-2">
        <span
          className="text-3xl text-amber-400 font-bold tabular-nums"
          style={MONO}
        >
          {n}
        </span>
        <h4 className="text-base text-amber-200 font-semibold leading-tight">
          {title}
        </h4>
      </div>
      <p className="text-sm text-gray-300 mb-2 leading-snug">{summary}</p>
      <ul className="text-caption text-gray-400 space-y-0.5 mt-auto" style={MONO}>
        {details.map((d) => (
          <li key={d}>· {d}</li>
        ))}
      </ul>
    </article>
  );
}
