"use client";

import { useMemo } from "react";
import { useWasm, type RustCurvePoint, type RustDrink, type RustProfile } from "./use-wasm";
import { CurveChart, type ChartPoint, type ChartSeries } from "./curve-chart";

const PROFILE: RustProfile = {
  weight_kg: 75,
  biological_sex: "male",
  height_cm: 178,
  age: 32,
};

const X_MAX_MIN = 240;

function curveFor(
  mod: ReturnType<typeof useWasm>,
  durationSecs: number,
): ChartPoint[] {
  if (!mod) return [];
  const drink: RustDrink = {
    volume_ml: 500,
    abv: 0.05,
    offset_secs: 0,
    duration_secs: durationSecs,
    stomach_state: "some_food",
  };
  const pts = mod.generateCurve(
    [drink],
    PROFILE,
    "watson",
    0,
    X_MAX_MIN * 60,
    60,
    0.06,
    0.09,
  ) as RustCurvePoint[];
  return pts.map((p) => ({ minute: p.offset_secs / 60, bac: p.bac }));
}

interface DurationSliderVizProps {
  durationMin: number;
  onDurationChange: (value: number) => void;
}

export function DurationSliderViz({
  durationMin,
  onDurationChange,
}: DurationSliderVizProps) {
  const mod = useWasm();

  const reference = useMemo(() => curveFor(mod, 0), [mod]);
  const points = useMemo(
    () => curveFor(mod, durationMin * 60),
    [mod, durationMin],
  );

  const series: ChartSeries[] = useMemo(
    () => [
      { label: "shot (0s)", color: "#555555", points: reference, dashed: true },
      { label: "500ml @ 5%", color: "#69f6b8", points },
    ],
    [reference, points],
  );

  return (
    <div className="flex flex-col gap-3">
      <CurveChart xMax={X_MAX_MIN} yMax={0.045} series={series} />
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wider text-on-surface-variant/60">
          duration
        </span>
        <input
          type="range"
          min={0}
          max={90}
          step={5}
          value={durationMin}
          onChange={(e) => onDurationChange(Number(e.target.value))}
          className="flex-1 accent-primary"
        />
        <span className="font-display tabular-nums text-sm text-on-surface">
          {durationMin === 0 ? "shot" : `${durationMin} min`}
        </span>
      </div>
    </div>
  );
}
