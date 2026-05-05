import { useState, useEffect, useRef, useCallback } from "react";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  type?: string;
  place_id?: number;
}

interface LocationSearchProps {
  /** Called with the lat/lng when the user picks a result. */
  onSelect: (lat: number, lng: number, label: string) => void;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/**
 * Free-form location search using OpenStreetMap Nominatim. No API key
 * required. Rate-limited to ~1 request/sec — debounce keystrokes.
 */
export default function LocationSearch({ onSelect }: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=0`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        setResults([]);
        return;
      }
      const data = (await res.json()) as NominatimResult[];
      setResults(data);
      setActiveIdx(data.length > 0 ? 0 : -1);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search on query change
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    const handle = setTimeout(() => search(query), 350);
    return () => clearTimeout(handle);
  }, [query, search]);

  // Close dropdown on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (r: NominatimResult) => {
    onSelect(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
    setQuery(r.display_name);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      choose(results[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query && setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search a location..."
          className="w-full bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08]
            border border-white/[0.06] focus:border-amber-500/40 outline-none
            rounded-lg pl-9 pr-8 py-2 text-sm text-gray-200 placeholder:text-gray-500
            transition-all duration-150"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        />
        {/* Search glyph */}
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        {/* Clear button */}
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full
              text-gray-500 hover:text-white hover:bg-white/10 flex items-center justify-center
              text-base leading-none transition-colors"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {open && (loading || results.length > 0) && (
        <div
          className="absolute left-0 right-0 mt-1 z-40 fire-panel rounded-lg max-h-72 overflow-y-auto"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
          {loading && results.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-gray-500">Searching...</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.place_id ?? `${r.lat}-${r.lon}-${i}`}
              type="button"
              onClick={() => choose(r)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-2 text-sm border-b border-white/[0.04] last:border-b-0
                transition-colors ${
                  i === activeIdx ? "bg-amber-500/15 text-amber-200" : "text-gray-300 hover:bg-white/[0.04]"
                }`}
            >
              <div className="line-clamp-2 leading-snug">{r.display_name}</div>
              {r.class && r.type && (
                <div className="text-micro text-gray-500 mt-0.5 capitalize">
                  {r.type.replace(/_/g, " ")} · {r.class}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
