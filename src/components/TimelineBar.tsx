import { useState, useEffect, useRef, useCallback } from "react";

interface TimelineBarProps {
  totalSteps: number;
  currentStep: number;
  onStepChange: (step: number) => void;
  timestepMinutes: number;
}

export default function TimelineBar({
  totalSteps,
  currentStep,
  onStepChange,
  timestepMinutes,
}: TimelineBarProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const formatTime = (step: number) => {
    const totalMinutes = step * timestepMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `T+${hours}h ${minutes.toString().padStart(2, "0")}m`;
  };

  const advance = useCallback(() => {
    onStepChange(Math.min(currentStep + 1, totalSteps - 1));
  }, [currentStep, totalSteps, onStepChange]);

  useEffect(() => {
    if (isPlaying && currentStep < totalSteps - 1) {
      intervalRef.current = setInterval(advance, 200 / speed);
    } else {
      if (currentStep >= totalSteps - 1) setIsPlaying(false);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying, speed, advance, currentStep, totalSteps]);

  if (totalSteps === 0) return null;

  const speeds = [0.5, 1, 2, 5];

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 bg-gray-900/90 backdrop-blur text-white px-4 py-3 flex items-center gap-4">
      <button
        onClick={() => setIsPlaying(!isPlaying)}
        className="w-10 h-10 flex items-center justify-center bg-orange-600 hover:bg-orange-500 rounded-full text-lg"
      >
        {isPlaying ? "\u23F8" : "\u25B6"}
      </button>

      <input
        type="range"
        min={0}
        max={totalSteps - 1}
        value={currentStep}
        onChange={(e) => {
          setIsPlaying(false);
          onStepChange(Number(e.target.value));
        }}
        className="flex-1 accent-orange-500"
      />

      <span className="text-sm font-mono w-28 text-center">
        {formatTime(currentStep)}
      </span>

      <div className="flex gap-1">
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-2 py-1 rounded text-xs ${
              speed === s ? "bg-orange-600" : "bg-gray-700 hover:bg-gray-600"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
