import { useState, useEffect, useRef } from "react";

interface TimelineBarProps {
  totalSteps: number;
  currentStep: number;
  onStepChange: (step: number) => void;
  timestepMinutes: number;
  dateLabels?: string[];
  autoPlay?: boolean;
}

export default function TimelineBar({
  totalSteps,
  currentStep,
  onStepChange,
  timestepMinutes,
  dateLabels,
  autoPlay,
}: TimelineBarProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const stepRef = useRef(currentStep);
  stepRef.current = currentStep;
  const totalStepsRef = useRef(totalSteps);
  totalStepsRef.current = totalSteps;

  const formatTime = (step: number) => {
    if (dateLabels && dateLabels[step]) {
      const raw = dateLabels[step];
      if (raw.startsWith("Day") || raw.startsWith("Before")) return raw;
      const d = new Date(raw + "T00:00:00Z");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    }
    const totalMinutes = step * timestepMinutes;
    const day = Math.floor(totalMinutes / 1440) + 1;
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return `D${day} ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    if (!isPlaying) return;
    const intervalId = setInterval(() => {
      const next = stepRef.current + 1;
      if (next >= totalStepsRef.current) {
        setIsPlaying(false);
        return;
      }
      onStepChange(next);
    }, 500 / speed);
    return () => clearInterval(intervalId);
  }, [isPlaying, speed, onStepChange]);

  useEffect(() => {
    if (currentStep >= totalSteps - 1) setIsPlaying(false);
  }, [currentStep, totalSteps]);

  useEffect(() => {
    if (autoPlay && totalSteps > 1) {
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  }, [totalSteps, autoPlay]);

  if (totalSteps === 0) return null;

  const progress = totalSteps > 1 ? (currentStep / (totalSteps - 1)) * 100 : 0;
  const speeds = [0.5, 1, 2, 5];

  return (
    <div className="fire-panel absolute bottom-3 left-3 right-3 z-50 rounded-xl text-white px-4 py-3">
      <div className="flex items-center gap-4">
        {/* Play/Pause */}
        <button
          onClick={() => {
            if (currentStep >= totalSteps - 1) {
              onStepChange(0);
              setIsPlaying(true);
            } else {
              setIsPlaying(!isPlaying);
            }
          }}
          className="w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer
            bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30
            text-amber-400 transition-all duration-200 flex-shrink-0"
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        {/* Timeline Track */}
        <div className="flex-1 relative">
          {/* Progress fill */}
          <div className="absolute top-1/2 -translate-y-1/2 left-0 h-1 rounded-full bg-amber-500/30 pointer-events-none" style={{ width: "100%" }} />
          <div
            className="absolute top-1/2 -translate-y-1/2 left-0 h-1 rounded-full pointer-events-none"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, #F59E0B, #EA580C)",
              boxShadow: "0 0 8px rgba(245, 158, 11, 0.4)",
            }}
          />
          <input
            type="range"
            min={0}
            max={totalSteps - 1}
            value={currentStep}
            onChange={(e) => {
              setIsPlaying(false);
              onStepChange(Number(e.target.value));
            }}
            className="fire-timeline w-full relative z-10"
            style={{ opacity: 0.01 }}
          />
          {/* Thumb indicator */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-400 pointer-events-none z-20"
            style={{
              left: `calc(${progress}% - 6px)`,
              boxShadow: "0 0 10px rgba(245, 158, 11, 0.7)",
            }}
          />
        </div>

        {/* Date Display */}
        <span
          className="text-xs font-medium w-36 text-center text-amber-400/90 flex-shrink-0"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {formatTime(currentStep)}
        </span>

        {/* Speed Controls */}
        <div className="flex gap-0.5 flex-shrink-0">
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-1 rounded text-[10px] font-semibold tracking-wide transition-all duration-150 cursor-pointer ${
                speed === s
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "text-gray-500 hover:text-gray-300 border border-transparent"
              }`}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Frame Counter */}
        <span
          className="text-[10px] text-gray-500 flex-shrink-0 tabular-nums"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {currentStep + 1}/{totalSteps}
        </span>
      </div>
    </div>
  );
}
