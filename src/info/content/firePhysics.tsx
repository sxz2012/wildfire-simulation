import type { InfoModalContent } from "../types";

const MONO = { fontFamily: "'JetBrains Mono', monospace" } as const;

export const firePhysicsContent: InfoModalContent = {
  id: "firePhysics",
  icon: "🌲",
  title: "Why fire moves the way it moves",
  subtitle: "Three drivers of wildfire spread: WIND, SLOPE, FUEL",
  body: (
    <>
      {/* The three big cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Driver
          icon="💨"
          name="Wind"
          kid="Wind pushes flames forward and sends sparks ahead. The fire chases the wind."
          spec="Doubles or triples the rate of spread. Controls fire shape — narrow head, wide flanks."
          accent="from-cyan-500/20 to-cyan-500/0"
          accentText="text-cyan-300"
        />
        <Driver
          icon="⛰️"
          name="Slope"
          kid="Fire LOVES uphill. Flames lean over and cook the next bushes before they ignite. A 45° slope can make fire spread up to 4× faster."
          spec="Pre-heating effect. Spread rate roughly doubles per 20° of slope."
          accent="from-orange-500/20 to-orange-500/0"
          accentText="text-orange-300"
        />
        <Driver
          icon="🌾"
          name="Fuel"
          kid="What's on the ground decides how fast it burns. Grass = paper (fast). Shrub = cardboard. Forest = logs (slow but hot)."
          spec="Each fuel model has its own R₀, packing ratio, and burnout time."
          accent="from-amber-500/20 to-amber-500/0"
          accentText="text-amber-300"
        />
      </section>

      {/* Head / flank / back diagram */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h3 className="text-amber-400 text-lg mb-1 tracking-[0.15em] uppercase" style={MONO}>
          The shape of a wind-driven fire
        </h3>
        <p className="text-sm text-gray-400 mb-4">
          A fire pushed by wind grows into an oval. Each side has a name —
          and a different danger.
        </p>

        <div className="rounded-xl overflow-hidden border border-white/[0.06] mb-4 bg-black/40">
          <img
            src="/images/info/wind-fire-shape.jpg"
            alt="Top-down view of a wind-driven wildfire showing head, flanks, back, and ignition point"
            className="w-full h-auto block"
            loading="lazy"
          />
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <FireSide
            color="bg-red-500"
            name="Head fire"
            description="Downwind side. Fastest, hottest, most dangerous. Direct attack here is risky."
          />
          <FireSide
            color="bg-amber-500"
            name="Flanks"
            description="Sides parallel to wind. Slower spread. Hand crews work the flanks to pinch the head."
          />
          <FireSide
            color="bg-emerald-500"
            name="Back fire"
            description="Upwind side. Burning into the wind, very slow. Anchor your line here first."
          />
        </div>
      </section>

      {/* Fuel comparison table */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h3 className="text-amber-400 text-lg mb-3 tracking-[0.15em] uppercase" style={MONO}>
          Fuel types in this simulator
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={MONO}>
            <thead>
              <tr className="text-caption uppercase tracking-wider text-gray-400 border-b border-white/[0.06]">
                <th className="text-left py-2 pr-4">Fuel</th>
                <th className="text-left py-2 pr-4">Kid analogy</th>
                <th className="text-left py-2 pr-4">Real-world spread</th>
                <th className="text-left py-2 pr-4">Burnout</th>
              </tr>
            </thead>
            <tbody className="text-gray-200">
              <tr className="border-b border-white/[0.04]">
                <td className="py-2 pr-4 text-amber-300">🌾 Grass</td>
                <td className="py-2 pr-4">Paper. Catches instantly, gone fast.</td>
                <td className="py-2 pr-4">11–14 km/day</td>
                <td className="py-2 pr-4">≈ 5 hours</td>
              </tr>
              <tr className="border-b border-white/[0.04]">
                <td className="py-2 pr-4 text-amber-300">🌿 Shrub</td>
                <td className="py-2 pr-4">Cardboard. Steadier burn, more heat.</td>
                <td className="py-2 pr-4">5–7 km/day</td>
                <td className="py-2 pr-4">≈ 10 hours</td>
              </tr>
              <tr className="border-b border-white/[0.04]">
                <td className="py-2 pr-4 text-amber-300">🌲 Forest</td>
                <td className="py-2 pr-4">Wood logs. Hard to start, very long burn.</td>
                <td className="py-2 pr-4">1–3 km/day</td>
                <td className="py-2 pr-4">≈ 20 hours</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-cyan-300">💧 Water</td>
                <td className="py-2 pr-4">Doesn't burn. Acts as a natural break.</td>
                <td className="py-2 pr-4">—</td>
                <td className="py-2 pr-4">—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-caption text-gray-500 mt-3">
          Spread rates calibrated against NASA FIRMS hotspots from real fires
          (Marshall, Maui, Caldor, Thomas, Woolsey).
        </p>
      </section>
    </>
  ),
  sources: (
    <>
      Rothermel (1972) USDA INT-115 · Andrews (2018) <em>The Rothermel surface fire spread model and associated developments</em> · NASA FIRMS · ESA WorldCover
    </>
  ),
};

function Driver({
  icon,
  name,
  kid,
  spec,
  accent,
  accentText,
}: {
  icon: string;
  name: string;
  kid: string;
  spec: string;
  accent: string;
  accentText: string;
}) {
  return (
    <article className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div
        className={`h-24 bg-gradient-to-b ${accent} flex items-center justify-center`}
      >
        <span className="text-6xl drop-shadow-lg" aria-hidden="true">{icon}</span>
      </div>
      <div className="p-4 space-y-2">
        <h4
          className={`text-xl font-bold tracking-[0.2em] uppercase ${accentText}`}
          style={MONO}
        >
          {name}
        </h4>
        <p className="text-base text-gray-200 leading-snug">{kid}</p>
        <p className="text-caption text-gray-500 pt-1 leading-snug" style={MONO}>
          {spec}
        </p>
      </div>
    </article>
  );
}

function FireSide({
  color,
  name,
  description,
}: {
  color: string;
  name: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <span className="text-amber-200 font-semibold" style={MONO}>{name}</span>
      </div>
      <p className="text-gray-300 text-sm leading-snug">{description}</p>
    </div>
  );
}
