import type { InfoModalContent } from "../types";
import ZoomableImage from "../ZoomableImage";

const MONO = { fontFamily: "'JetBrains Mono', monospace" } as const;

export const suppressionContent: InfoModalContent = {
  id: "suppression",
  icon: "🛡️",
  title: "How firefighters stop a wildfire",
  subtitle: "You can't put out a wildfire — you take its fuel away",
  body: (
    <>
      {/* Mental model anchor */}
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-4">
        <p className="text-base text-amber-100 leading-snug">
          Wildland firefighters rarely "spray water on the fire."
          They build a <strong>fireline</strong>: a strip of bare dirt the fire
          can't cross. When the line goes all the way around the fire,
          it has nowhere left to go. It's <strong>contained</strong>.
        </p>
      </section>

      {/* Direct vs indirect attack */}
      <section>
        <h3 className="text-amber-400 text-lg mb-3 tracking-[0.15em] uppercase" style={MONO}>
          Two ways to attack
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Tactic
            name="Direct attack"
            kid="Build the fireline RIGHT at the edge of the flames."
            tradeoffs={[
              "Used on small or slow fires",
              "Fastest containment when it works",
              "Dangerous — close to active flame",
            ]}
            diagram={<DirectAttackSVG />}
          />
          <Tactic
            name="Indirect attack"
            kid="Build the fireline WAY out ahead of the fire — at a road, river, or ridge — and let the fire come to it."
            tradeoffs={[
              "Used on big, fast, or unsafe fires",
              "Sacrifices ground between line and fire",
              "Often the only safe option",
            ]}
            diagram={<IndirectAttackSVG />}
          />
        </div>
      </section>

      {/* Line construction with chains/hr */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h3 className="text-amber-400 text-lg mb-3 tracking-[0.15em] uppercase" style={MONO}>
          What "chains per hour" means
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <p className="text-base text-gray-200 leading-snug mb-2">
              Firelines are measured in <strong>chains</strong> — an old surveying
              unit. <strong>1 chain ≈ 20 m</strong>, about as long as a school
              hallway.
            </p>
            <p className="text-base text-gray-200 leading-snug">
              A Type 1 dozer rips through 75 chains every hour. That's
              <strong className="text-amber-300"> 1.5 km of new line per hour</strong>{" "}
              — three full football fields, end to end.
            </p>
          </div>
          <div className="space-y-1.5" style={MONO}>
            <Bar label="🚜 Type 1 dozer" value={75} max={75} text="75 ch/hr" />
            <Bar label="🧯 Type 1 crew" value={9} max={75} text="9 ch/hr" />
            <Bar label="👷 Type 2 crew" value={6} max={75} text="6 ch/hr" />
            <Bar label="🚒 Engine" value={4} max={75} text="4 ch/hr" />
            <Bar label="🚁 Helitack" value={0} max={75} text="aerial — slows spread" muted />
            <Bar label="✈️ Tanker" value={0} max={75} text="aerial — drops retardant" muted />
          </div>
        </div>
      </section>

      {/* Aerial drops */}
      <section>
        <h3 className="text-amber-400 text-lg mb-3 tracking-[0.15em] uppercase" style={MONO}>
          Water vs. retardant — what's actually being dropped?
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DropType
            color="from-cyan-500/20"
            name="Water (helitack)"
            volume="Bambi bucket: ~1,000 gal"
            range="~8-chain (≈ 160 m) drop swath"
            purpose="Cools active flame fronts; lets ground crews close the gap. Effect is local and short-lived."
          />
          <DropType
            color="from-rose-500/20"
            name="Retardant (air tanker)"
            volume="DC-10: ~12,000 gal of Phos-Chek"
            range="~50 chains (≈ 1 km) of red retardant line"
            purpose="Coats fuel ahead of the fire so it can't ignite easily. Buys time. Ground crews must follow up."
          />
        </div>
      </section>

      {/* Tie back to the sim */}
      <section className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.05] p-4">
        <h3 className="text-cyan-300 text-lg mb-2 tracking-[0.15em] uppercase" style={MONO}>
          What you see on the map
        </h3>
        <p className="text-base text-gray-200 leading-snug">
          The <span className="text-cyan-300 font-semibold">cyan rim</span> growing around the fire is the
          containment line being constructed. Every minute of sim time it
          grows by the rate above (sum of dozers + crews + engines on scene).
          When the rim closes the loop and matches the active perimeter,
          the fire is contained.
        </p>
      </section>
    </>
  ),
  sources: (
    <>
      NWCG Standards for Interagency Incident Business Management · Reed &amp; McCool (2000) <em>Containment of Wildland Fires by Line Construction</em> · Hirsch &amp; Martell (1996) — response delay decay
    </>
  ),
};

function Tactic({
  name,
  kid,
  tradeoffs,
  diagram,
}: {
  name: string;
  kid: string;
  tradeoffs: string[];
  diagram: React.ReactNode;
}) {
  return (
    <article className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden flex flex-col">
      <div className="relative h-64 bg-black/40 overflow-hidden">
        {diagram}
      </div>
      <div className="p-4 space-y-2">
        <h4 className="text-lg text-amber-200 font-semibold" style={MONO}>
          {name}
        </h4>
        <p className="text-base text-gray-200 leading-snug">{kid}</p>
        <ul className="text-caption text-gray-400 space-y-0.5 pt-1" style={MONO}>
          {tradeoffs.map((t) => (
            <li key={t}>· {t}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function Bar({
  label,
  value,
  max,
  text,
  muted,
}: {
  label: string;
  value: number;
  max: number;
  text: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-36 text-sm text-gray-300 shrink-0">{label}</div>
      <div className="flex-1 h-6 bg-white/[0.04] rounded-md overflow-hidden relative">
        {!muted && (
          <div
            className="h-full rounded-md bg-gradient-to-r from-amber-500 to-orange-500"
            style={{ width: `${(value / max) * 100}%` }}
          />
        )}
        <span
          className={`absolute inset-0 flex items-center px-2 text-caption ${
            muted ? "text-amber-400/60 italic" : "text-white"
          }`}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

function DropType({
  color,
  name,
  volume,
  range,
  purpose,
}: {
  color: string;
  name: string;
  volume: string;
  range: string;
  purpose: string;
}) {
  return (
    <article className={`rounded-xl border border-white/[0.06] bg-gradient-to-b ${color} to-transparent p-4`}>
      <h4 className="text-lg text-amber-200 font-semibold mb-2" style={MONO}>
        {name}
      </h4>
      <div className="space-y-1.5 mb-3 text-sm" style={MONO}>
        <div className="flex justify-between">
          <span className="text-gray-400">Volume</span>
          <span className="text-amber-100 tabular-nums">{volume}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Reach</span>
          <span className="text-amber-100 tabular-nums">{range}</span>
        </div>
      </div>
      <p className="text-base text-gray-200 leading-snug">{purpose}</p>
    </article>
  );
}

function DirectAttackSVG() {
  return (
    <ZoomableImage
      src="/images/info/direct-attack.jpg"
      alt="Aerial diagram of a direct attack — fireline cut at the back edge of the fire with a dozer + crew + engine, head and flanks labeled"
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}

function IndirectAttackSVG() {
  return (
    <ZoomableImage
      src="/images/info/indirect-attack.jpg"
      alt="Aerial diagram of an indirect attack — wind direction, fireline, sacrifice zone, indirect line being cut by dozers, and the unburned area being protected"
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}

