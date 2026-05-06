import {
  RESOURCE_RATES,
  type ResourceCount,
  type ResourceType,
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
}: SuppressionInputsProps) {
  const wildfireOnly = resources.length === 0;
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

      {wildfireOnly ? (
        <div className="text-sm text-gray-400 leading-relaxed">
          Live wildfire only. Pause the sim and use{" "}
          <span className="text-amber-400">Suggest Containment</span> to draw a
          boundary and have the system recommend the minimum response.
        </div>
      ) : (
        <>
          <div className="text-sm text-gray-400 leading-relaxed mb-2">
            Response deployed at <span className="text-amber-400">{responseDelayMin} min</span>:
          </div>
          <ul className="text-sm text-gray-300 mb-2 space-y-0.5">
            {resources.map((r) => {
              const meta = RESOURCE_RATES[r.type as ResourceType];
              return (
                <li key={r.type}>
                  <span className="text-amber-400">{r.count}×</span> {meta?.label ?? r.type}
                </li>
              );
            })}
          </ul>
          <div className="text-micro text-gray-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            Estimated production: {chainsHr} chains/hr ({Math.round(lineMetersHr)} m/hr)
          </div>
        </>
      )}
    </div>
  );
}
