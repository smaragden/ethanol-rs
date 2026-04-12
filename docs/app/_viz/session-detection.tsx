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

// Two sessions with a gap big enough for BAC to fully metabolise
// between them — that's exactly the condition that makes the library
// treat them as separate sessions.
const SESSION_1: RustDrink[] = withPace([
  { volume_ml: 330, abv: 0.05, offset_secs: 0, duration_secs: 0, stomach_state: "some_food" },
  { volume_ml: 330, abv: 0.05, offset_secs: 1800, duration_secs: 0, stomach_state: "some_food" },
]);

const SESSION_2: RustDrink[] = withPace([
  { volume_ml: 330, abv: 0.05, offset_secs: 9 * 3600, duration_secs: 0, stomach_state: "some_food" },
  { volume_ml: 150, abv: 0.12, offset_secs: 10 * 3600, duration_secs: 0, stomach_state: "some_food" },
  { volume_ml: 330, abv: 0.05, offset_secs: Math.round(10.5 * 3600), duration_secs: 0, stomach_state: "some_food" },
]);

const SPLIT_MIN = 7 * 60;
const X_MAX_MIN = 13 * 60;

export function SessionDetectionViz() {
  const mod = useWasm();
  const points: ChartPoint[] = useMemo(() => {
    if (!mod) return [];
    // generate_curve drops "past" sessions, so we call it once per session
    // across its own time window and stitch the results together.
    const s1 = mod.generateCurve(
      SESSION_1,
      PROFILE,
      "watson",
      0,
      SPLIT_MIN * 60,
      120,
      0.06,
      0.09,
    ) as RustCurvePoint[];
    const s2 = mod.generateCurve(
      SESSION_2,
      PROFILE,
      "watson",
      SPLIT_MIN * 60,
      X_MAX_MIN * 60,
      120,
      0.06,
      0.09,
    ) as RustCurvePoint[];
    return [...s1, ...s2].map((p) => ({
      minute: p.offset_secs / 60,
      bac: p.bac,
    }));
  }, [mod]);

  return (
    <CurveChart
      xMax={X_MAX_MIN}
      series={[{ label: "BAC", color: "#69f6b8", points }]}
      annotations={[
        { minute: 0, label: "session 1", color: "#69f6b8" },
        { minute: 9 * 60, label: "session 2", color: "#69f6b8" },
      ]}
    />
  );
}
