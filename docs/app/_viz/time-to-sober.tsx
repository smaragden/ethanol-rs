"use client";

import { useMemo } from "react";
import { useWasm, withPace, type RustDrink, type RustProfile } from "./use-wasm";

const PROFILE: RustProfile = {
  weight_kg: 75,
  biological_sex: "male",
  height_cm: 178,
  age: 32,
};

function formatDuration(mins: number): string {
  if (mins <= 0) return "already sober";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}m`;
}

interface TimeToSoberVizProps {
  numBeers: number;
  onNumBeersChange: (value: number) => void;
}

export function TimeToSoberViz({
  numBeers,
  onNumBeersChange,
}: TimeToSoberVizProps) {
  const mod = useWasm();

  const result = useMemo(() => {
    if (!mod) return { bac: 0, sober: 0 };
    const drinks: RustDrink[] = withPace(
      Array.from({ length: numBeers }, (_, i) => ({
        volume_ml: 330,
        abv: 0.05,
        offset_secs: -(numBeers - i) * 1800,
        duration_secs: 0,
        stomach_state: "some_food",
      })),
    );
    const bac = mod.calculateBAC(drinks, PROFILE, "watson") as number;
    const sober = mod.minutesUntilSober(drinks, PROFILE, "watson") as number;
    return { bac, sober };
  }, [mod, numBeers]);

  return (
    <div className="flex flex-col items-center gap-5 py-4">
      <div className="flex items-baseline gap-6">
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/50">
            current BAC
          </p>
          <p className="font-display text-4xl font-bold tabular-nums text-primary">
            {result.bac.toFixed(3)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/50">
            sober in
          </p>
          <p className="font-display text-4xl font-bold tabular-nums text-on-surface">
            {formatDuration(result.sober)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wider text-on-surface-variant/60">
          beers
        </span>
        <input
          type="range"
          min={0}
          max={8}
          step={1}
          value={numBeers}
          onChange={(e) => onNumBeersChange(Number(e.target.value))}
          className="w-48 accent-primary"
        />
        <span className="font-display tabular-nums text-sm text-on-surface">
          {numBeers}
        </span>
      </div>
    </div>
  );
}
