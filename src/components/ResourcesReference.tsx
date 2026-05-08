import type { ReactElement } from "react";
import { RESOURCE_RATES, ResourceType } from "../simulation/types";

const MONO_FONT = { fontFamily: "'JetBrains Mono', monospace" } as const;
const SANS_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

interface ResourcesReferenceProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ResourceEntry {
  emoji: string;
  imageUrl: string;
  imageCredit: string;
  type: ResourceType;
  childExplanation: string;
  technicalNote: string;
}

const RESOURCE_ENTRIES: ResourceEntry[] = [
  {
    emoji: "🧯",
    imageUrl: "/images/resources/type1Crew.jpg",
    imageCredit: "Illustration",
    type: ResourceType.Type1Crew,
    childExplanation:
      "A 20-person team of the most experienced firefighters. They hike into the wilderness with hand tools and chainsaws to dig a fireline — a strip of bare ground that fire can't cross.",
    technicalNote:
      "Interagency Hotshot Crew (IHC). Production rate per NWCG Standards.",
  },
  {
    emoji: "👷",
    imageUrl: "/images/resources/type2Crew.jpg",
    imageCredit: "Illustration",
    type: ResourceType.Type2Crew,
    childExplanation:
      "A 20-person hand crew, similar to a hotshot crew but a little less specialized. They also dig fireline by hand with shovels, pulaskis (a special tool that's half-axe, half-hoe), and chainsaws.",
    technicalNote:
      "Type 2 hand crew. Roughly 65% of Type 1 production rate.",
  },
  {
    emoji: "🚒",
    imageUrl: "/images/resources/engine.jpg",
    imageCredit: "Illustration",
    type: ResourceType.Engine,
    childExplanation:
      "A wildland fire engine with 3-4 firefighters. It carries water and foam, and sprays the edge of the fire to cool it down. Engines work best on roads and near houses where they can pump water.",
    technicalNote:
      "Type 3/Type 6 engine. Lower line-build rate because the primary mission is water support, not new line construction.",
  },
  {
    emoji: "🚜",
    imageUrl: "/images/resources/dozer.jpg",
    imageCredit: "Illustration",
    type: ResourceType.Type1Dozer,
    childExplanation:
      "A giant tracked bulldozer (like the ones at construction sites) that pushes brush and small trees aside to make a wide road of bare dirt — the dozer line. It's the fastest way to build fireline by far.",
    technicalNote:
      "Type 1 transport dozer (CAT D7/D8 class). Most cost-effective ground resource at $67/chain.",
  },
  {
    emoji: "🚁",
    imageUrl: "/images/resources/helitack.jpg",
    imageCredit: "Illustration",
    type: ResourceType.Helitack,
    childExplanation:
      "A helicopter with a water bucket hanging underneath, plus a small crew of firefighters who can rappel out to remote spots. The helicopter scoops water from a lake or a portable pond and dumps it on the hottest part of the fire to slow it down.",
    technicalNote:
      "Type 1/2 helitack with bucket. Modeled as a 0.4× ROS reduction over an 8-chain (~161 m) drop swath, not direct line construction.",
  },
  {
    emoji: "✈️",
    imageUrl: "/images/resources/airTanker.jpg",
    imageCredit: "Illustration",
    type: ResourceType.AirTanker,
    childExplanation:
      "A huge airplane (like a converted DC-10 jetliner) that drops a long red line of fire retardant (a kind of fire-slowing slurry called Phos-Chek). It can drop up to 12,000 gallons in a single pass — enough to cover a long stretch of forest. Ground crews then build line behind the retardant.",
    technicalNote:
      "Large fixed-wing tanker. 50 chains of retardant line per drop × 2 drops/hr (typical turnaround). Retardant DELAYS fire, doesn't stop it — must be followed by ground line construction.",
  },
];

interface BundlePreset {
  key: string;
  display: string;
  composition: string;
  whenUsed: string;
}

const BUNDLE_PRESETS: BundlePreset[] = [
  {
    key: "initialAttack",
    display: "Initial Attack",
    composition: "1 hand crew · 1 engine · 1 helitack",
    whenUsed:
      "First arrivals on a small, just-detected fire. Goal: catch it before it grows.",
  },
  {
    key: "type3",
    display: "Type 3 (Medium)",
    composition: "3 crews · 2 engines · 2 helitack",
    whenUsed:
      "Established fire that grew past initial attack. Multi-engine response.",
  },
  {
    key: "type2",
    display: "Type 2 (Large)",
    composition: "5 crews · 3 dozers · 2 helitack · 1 air tanker",
    whenUsed:
      "Major fire requiring a full Incident Management Team. Often multi-day.",
  },
  {
    key: "type1",
    display: "Type 1 (Maximum)",
    composition: "10 crews · 5 dozers · 3 helitack · 2 air tankers",
    whenUsed:
      "The biggest single-incident response — comparable to a Camp-Fire or Dixie-Fire-level deployment.",
  },
];

export default function ResourcesReference({
  isOpen,
  onClose,
}: ResourcesReferenceProps): ReactElement | null {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        ...SANS_FONT,
      }}
      onClick={onClose}
    >
      <div
        className="fire-panel rounded-2xl text-white max-h-[96vh] w-[min(1280px,96vw)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]"
          style={MONO_FONT}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
            <h2 className="text-lg tracking-[0.2em] uppercase text-amber-400 font-bold">
              Wildfire Suppression Resources
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close reference"
            className="text-gray-400 hover:text-amber-200 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-white/[0.04] transition-colors"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5 space-y-8">
          <p className="text-base text-gray-300 leading-relaxed">
            When a wildfire starts, an{" "}
            <span className="text-amber-400">Incident Commander (IC)</span>{" "}
            decides what mix of resources to deploy. Each resource has different
            strengths — speed, reach, water, terrain access. Below: every
            resource type the simulator knows about, what it does, how fast it
            builds containment line, and what it costs per hour.
          </p>

          <section>
            <h3
              className="text-label uppercase tracking-[0.18em] text-amber-400 mb-4"
              style={MONO_FONT}
            >
              The Six Resource Types
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {RESOURCE_ENTRIES.map((entry) => (
                <ResourceCard key={entry.type} entry={entry} />
              ))}
            </div>
          </section>

          <section>
            <h3
              className="text-label uppercase tracking-[0.18em] text-amber-400 mb-3"
              style={MONO_FONT}
            >
              Production Rate — How Fast Each One Builds Line
            </h3>
            <p className="text-sm text-gray-400 mb-4 leading-relaxed">
              Each bar is how much fireline (in meters per hour) a single
              resource of that type can build. A bulldozer is roughly{" "}
              <span className="text-amber-300">8× faster</span> than a hand
              crew — that's why the system recommends dozers first.
            </p>
            <ProductionBars />
          </section>

          <section>
            <h3
              className="text-label uppercase tracking-[0.18em] text-amber-400 mb-3"
              style={MONO_FONT}
            >
              Cost Per Meter of Line — The Economic Side
            </h3>
            <p className="text-sm text-gray-400 mb-4 leading-relaxed">
              Hourly cost ÷ meters of line per hour. Lower is more
              cost-effective. Dozers are far the cheapest way to build line.
              Aerial resources don't build line directly so they're not
              compared here.
            </p>
            <CostPerMeterBars />
          </section>

          <section>
            <h3
              className="text-label uppercase tracking-[0.18em] text-amber-400 mb-3"
              style={MONO_FONT}
            >
              Standard Bundles (NWCG Tier Ladder)
            </h3>
            <div className="space-y-2.5">
              {BUNDLE_PRESETS.map((b) => (
                <div
                  key={b.key}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className="text-base font-semibold text-amber-200"
                      style={MONO_FONT}
                    >
                      {b.display}
                    </span>
                    <span className="text-sm text-gray-400">
                      {b.composition}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mt-1 leading-relaxed">
                    {b.whenUsed}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3
              className="text-label uppercase tracking-[0.18em] text-amber-400 mb-3"
              style={MONO_FONT}
            >
              How the Numbers Are Estimated
            </h3>
            <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
              <p>
                <span className="text-amber-300 font-semibold">
                  Production rate (chains/hr).
                </span>{" "}
                Each resource builds fireline at a rate calibrated against{" "}
                <span className="text-amber-400">
                  NWCG Standards for Interagency Incident Business Management
                </span>
                . A "chain" is an old surveying unit equal to 66 feet (about 20
                m). A Type 1 dozer at 75 ch/hr clears about 1.5 km of new line
                every hour.
              </p>
              <p>
                <span className="text-amber-300 font-semibold">
                  Aerial resources don't build line directly.
                </span>{" "}
                Helitack is modeled as a 0.4× ROS (rate-of-spread) reduction
                inside its drop swath. Air tankers paint retardant — 50 chains
                per drop × 2 drops/hr = 100 ch/hr equivalent — but retardant
                only delays fire, so ground crews must follow.
              </p>
              <p>
                <span className="text-amber-300 font-semibold">
                  Response delay decay (Hirsch–Martell 1996).
                </span>{" "}
                Every minute crews wait reduces effective productivity. Modeled
                as <code>delayDecay = max(0.4, 1 − 0.003 × delayMin)</code> — a
                30-minute response delay drops effective output to ~91%; an
                hour, ~82%; floor at 40%.
              </p>
              <p>
                <span className="text-amber-300 font-semibold">
                  Containment probability (Reed–McCool 2000).
                </span>{" "}
                <code>
                  P_contain = 1 − exp(−1.2 × line_built / active_perimeter)
                </code>
                . Once your built line approaches the active fire perimeter,
                containment goes to 100%.
              </p>
              <p>
                <span className="text-amber-300 font-semibold">Cost.</span> The
                $/hour figure is the sum of NWCG-published hourly rates for
                each resource × the count deployed. Order-of-magnitude figure;
                actual cost depends on contracts, staging, and overtime.
              </p>
              <p>
                <span className="text-amber-300 font-semibold">
                  Inverse search (the "Recommend a roster" feature).
                </span>{" "}
                The system bisects on total chains/hr capacity (range 0–2500),
                building the cheapest mix at each candidate (greedy by
                $/chain), running a 30-step extension simulation, and accepting
                if at most 2% of the fire ends up outside your drawn polygon.
                Converges in ≤ 8 sim runs.
              </p>
            </div>
          </section>

          <section>
            <h3
              className="text-label uppercase tracking-[0.18em] text-amber-400 mb-3"
              style={MONO_FONT}
            >
              References
            </h3>
            <ul
              className="text-sm text-gray-400 space-y-1 leading-relaxed"
              style={MONO_FONT}
            >
              <li>
                NWCG Standards — production rates, costs, tier definitions.
                <br />
                <span className="text-amber-400">
                  https://www.nwcg.gov/publications
                </span>
              </li>
              <li>
                Rothermel (1972). USDA Forest Service Research Paper INT-115 —
                surface fire spread base equation.
              </li>
              <li>
                Albini (1976). USDA Tech Report — fuel coefficients.
              </li>
              <li>
                Hirsch &amp; Martell (1996). <em>Int'l J. Wildland Fire</em> —
                response delay decay model.
              </li>
              <li>
                Reed &amp; McCool (2000). <em>Containment of Wildland Fires by
                Line Construction</em>.
              </li>
              <li>
                ESA WorldCover — 10 m vegetation map.
                <br />
                <span className="text-amber-400">
                  https://esa-worldcover.org/
                </span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function ResourceCard({ entry }: { entry: ResourceEntry }): ReactElement {
  const meta = RESOURCE_RATES[entry.type];
  return (
    <article className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden flex flex-col">
      <div className="relative h-56 bg-black/40 overflow-hidden">
        <img
          src={entry.imageUrl}
          alt={entry.type}
          loading="lazy"
          className="w-full h-full object-contain"
        />
        {/* Bottom darkening gradient so the credit pill stays readable
            against bright illustration content. */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/50 pointer-events-none" />
        <span
          className="absolute top-3 left-3 text-3xl drop-shadow-lg"
          aria-hidden="true"
        >
          {entry.emoji}
        </span>
        <span
          className="absolute bottom-2 right-3 text-micro text-white/70"
          style={MONO_FONT}
        >
          {entry.imageCredit}
        </span>
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <h4
          className="text-base font-semibold text-amber-200 mb-2"
          style={MONO_FONT}
        >
          {meta.label}
        </h4>
        <div className="flex flex-wrap gap-2 mb-3">
          <Pill
            label="Production"
            value={
              meta.chainsPerHour > 0
                ? `${meta.chainsPerHour} ch/hr`
                : "aerial (no direct line)"
            }
          />
          <Pill label="Cost" value={`$${(meta.costPerHour / 1000).toFixed(0)}k/hr`} />
        </div>
        <p className="text-sm text-gray-300 leading-relaxed flex-1">
          {entry.childExplanation}
        </p>
        <p
          className="text-micro text-gray-500 mt-2 leading-snug"
          style={MONO_FONT}
        >
          {entry.technicalNote}
        </p>
      </div>
    </article>
  );
}

function ProductionBars(): ReactElement {
  // chains/hr -> meters/hr (1 chain = 20.117 m). Aerial resources have
  // chainsPerHour = 0 so we display them with an "aerial" tag instead.
  const rows = RESOURCE_ENTRIES.map((entry) => {
    const meta = RESOURCE_RATES[entry.type];
    return {
      label: meta.label,
      emoji: entry.emoji,
      metersPerHour: meta.chainsPerHour * 20.117,
      isAerial: meta.chainsPerHour === 0,
    };
  });
  const max = Math.max(...rows.map((r) => r.metersPerHour));

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <div className="w-44 flex items-center gap-2 shrink-0">
            <span aria-hidden="true">{row.emoji}</span>
            <span className="text-sm text-gray-300">{row.label}</span>
          </div>
          <div className="flex-1 h-7 bg-white/[0.04] rounded-md overflow-hidden relative">
            {row.isAerial ? (
              <span
                className="absolute inset-0 flex items-center px-3 text-micro text-amber-400/70 italic"
                style={MONO_FONT}
              >
                aerial — affects spread, not direct line
              </span>
            ) : (
              <>
                <div
                  className="h-full rounded-md bg-gradient-to-r from-amber-500 to-orange-500"
                  style={{ width: `${(row.metersPerHour / max) * 100}%` }}
                />
                <span
                  className="absolute inset-0 flex items-center px-3 text-sm text-white tabular-nums"
                  style={MONO_FONT}
                >
                  {Math.round(row.metersPerHour).toLocaleString()} m/hr
                </span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CostPerMeterBars(): ReactElement {
  // Filter aerial out — they have chainsPerHour = 0 so cost-per-meter is undefined.
  const rows = RESOURCE_ENTRIES.filter((e) => RESOURCE_RATES[e.type].chainsPerHour > 0).map(
    (entry) => {
      const meta = RESOURCE_RATES[entry.type];
      const metersPerHour = meta.chainsPerHour * 20.117;
      return {
        label: meta.label,
        emoji: entry.emoji,
        costPerMeter: meta.costPerHour / metersPerHour,
      };
    },
  );
  const max = Math.max(...rows.map((r) => r.costPerMeter));

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <div className="w-44 flex items-center gap-2 shrink-0">
            <span aria-hidden="true">{row.emoji}</span>
            <span className="text-sm text-gray-300">{row.label}</span>
          </div>
          <div className="flex-1 h-7 bg-white/[0.04] rounded-md overflow-hidden relative">
            <div
              className="h-full rounded-md bg-gradient-to-r from-cyan-700 to-cyan-500"
              style={{ width: `${(row.costPerMeter / max) * 100}%` }}
            />
            <span
              className="absolute inset-0 flex items-center px-3 text-sm text-white tabular-nums"
              style={MONO_FONT}
            >
              ${row.costPerMeter.toFixed(2)} / m
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <span
      className="inline-flex items-baseline gap-1.5 rounded-md
        px-2 py-0.5 bg-amber-500/10 border border-amber-500/20"
      style={MONO_FONT}
    >
      <span className="text-micro text-amber-400/70 uppercase tracking-wider">
        {label}
      </span>
      <span className="text-sm text-amber-200 tabular-nums">{value}</span>
    </span>
  );
}
