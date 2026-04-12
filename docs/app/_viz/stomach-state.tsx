"use client";

import { useMemo } from "react";
import { useWasm, type RustCurvePoint, type RustDrink, type RustProfile } from "./use-wasm";
import { CurveChart, type ChartPoint } from "./curve-chart";

const PROFILE: RustProfile = {
  weight_kg: 75,
  biological_sex: "male",
  height_cm: 178,
  age: 32,
};

const STATES: { label: string; state: RustDrink["stomach_state"]; color: string }[] = [
  { label: "empty", state: "empty", color: "#ff716a" },
  { label: "some food", state: "some_food", color: "#f8a010" },
  { label: "full", state: "full", color: "#69f6b8" },
];

const X_MAX_MIN = 240;

export function StomachStateViz() {
  const mod = useWasm();
  const series = useMemo(() => {
    if (!mod) return STATES.map((s) => ({ label: s.label, color: s.color, points: [] as ChartPoint[] }));
    return STATES.map((s) => {
      const drink: RustDrink = {
        volume_ml: 500,
        abv: 0.06,
        offset_secs: 0,
        duration_secs: 0,
        stomach_state: s.state,
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
      return {
        label: s.label,
        color: s.color,
        points: pts.map((p) => ({ minute: p.offset_secs / 60, bac: p.bac })),
      };
    });
  }, [mod]);

  return <CurveChart xMax={X_MAX_MIN} series={series} yMax={0.08} />;
}
