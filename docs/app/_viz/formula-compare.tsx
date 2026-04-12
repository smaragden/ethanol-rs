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

const PROFILE: RustProfile = {
  weight_kg: 75,
  biological_sex: "male",
  height_cm: 178,
  age: 32,
};

const DRINKS: RustDrink[] = withPace([
  { volume_ml: 330, abv: 0.05, offset_secs: 0, duration_secs: 0, stomach_state: "some_food" },
  { volume_ml: 330, abv: 0.05, offset_secs: 1800, duration_secs: 0, stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 3600, duration_secs: 0, stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 5400, duration_secs: 0, stomach_state: "some_food" },
]);

const X_MAX_MIN = 360;

function curveFor(
  mod: ReturnType<typeof useWasm>,
  formula: "widmark" | "watson",
): ChartPoint[] {
  if (!mod) return [];
  const pts = mod.generateCurve(
    DRINKS,
    PROFILE,
    formula,
    0,
    X_MAX_MIN * 60,
    60,
    0.06,
    0.09,
  ) as RustCurvePoint[];
  return pts.map((p) => ({ minute: p.offset_secs / 60, bac: p.bac }));
}

export function FormulaCompareViz() {
  const mod = useWasm();
  const widmark = useMemo(() => curveFor(mod, "widmark"), [mod]);
  const watson = useMemo(() => curveFor(mod, "watson"), [mod]);

  return (
    <CurveChart
      xMax={X_MAX_MIN}
      series={[
        { label: "Widmark", color: "#f8a010", points: widmark },
        { label: "Watson", color: "#69f6b8", points: watson },
      ]}
    />
  );
}
