"use client";

import { useMemo } from "react";
import {
  useWasm,
  withPace,
  type RustCurvePoint,
  type RustDrink,
  type RustProfile,
} from "./use-wasm";
import { CurveChart, type ChartPoint } from "./curve-chart";

const DRINKS: RustDrink[] = withPace([
  { volume_ml: 330, abv: 0.05, offset_secs: 0, duration_secs: 0, stomach_state: "some_food" },
  { volume_ml: 330, abv: 0.05, offset_secs: 1800, duration_secs: 0, stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 3600, duration_secs: 0, stomach_state: "some_food" },
]);

const X_MAX_MIN = 360;
const WEIGHTS = [55, 75, 95];
const COLORS = ["#ff716a", "#f8a010", "#69f6b8"];

function profileFor(weightKg: number): RustProfile {
  return {
    weight_kg: weightKg,
    biological_sex: "male",
    height_cm: 178,
    age: 32,
  };
}

export function WeightSensitivityViz() {
  const mod = useWasm();
  const series = useMemo(() => {
    if (!mod) return WEIGHTS.map((w, i) => ({ label: `${w} kg`, color: COLORS[i], points: [] as ChartPoint[] }));
    return WEIGHTS.map((w, i) => {
      const pts = mod.generateCurve(
        DRINKS,
        profileFor(w),
        "watson",
        0,
        X_MAX_MIN * 60,
        60,
        0.06,
        0.09,
      ) as RustCurvePoint[];
      return {
        label: `${w} kg`,
        color: COLORS[i],
        points: pts.map((p) => ({ minute: p.offset_secs / 60, bac: p.bac })),
      };
    });
  }, [mod]);

  return <CurveChart xMax={X_MAX_MIN} series={series} />;
}
