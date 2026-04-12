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
  { volume_ml: 150, abv: 0.12, offset_secs: 2700, duration_secs: 0, stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 5400, duration_secs: 0, stomach_state: "some_food" },
]);

const MALE: RustProfile = {
  weight_kg: 75,
  biological_sex: "male",
  height_cm: 178,
  age: 32,
};

const FEMALE: RustProfile = {
  weight_kg: 75,
  biological_sex: "female",
  height_cm: 178,
  age: 32,
};

const X_MAX_MIN = 360;

function curveFor(mod: ReturnType<typeof useWasm>, profile: RustProfile): ChartPoint[] {
  if (!mod) return [];
  const pts = mod.generateCurve(
    DRINKS,
    profile,
    "watson",
    0,
    X_MAX_MIN * 60,
    60,
    0.06,
    0.09,
  ) as RustCurvePoint[];
  return pts.map((p) => ({ minute: p.offset_secs / 60, bac: p.bac }));
}

export function SexCompareViz() {
  const mod = useWasm();
  const male = useMemo(() => curveFor(mod, MALE), [mod]);
  const female = useMemo(() => curveFor(mod, FEMALE), [mod]);

  return (
    <CurveChart
      xMax={X_MAX_MIN}
      series={[
        { label: "\u2642 male 75 kg", color: "#69f6b8", points: male },
        { label: "\u2640 female 75 kg", color: "#ff716a", points: female },
      ]}
    />
  );
}
