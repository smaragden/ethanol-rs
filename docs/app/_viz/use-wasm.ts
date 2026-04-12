"use client";

import { useEffect, useState } from "react";
import { drinkingTimeSecs } from "@/app/simulator/lib/drinking-time";

type WasmModule = typeof import("@/lib/wasm/ethanol-rs-wasm/ethanol_rs_wasm");

let cached: WasmModule | null = null;
let loading: Promise<WasmModule> | null = null;

export function useWasm(): WasmModule | null {
  const [mod, setMod] = useState<WasmModule | null>(cached);

  useEffect(() => {
    if (cached) {
      setMod(cached);
      return;
    }
    if (!loading) {
      loading = import("@/lib/wasm/ethanol-rs-wasm/ethanol_rs_wasm").then((m) => {
        cached = m;
        return m;
      });
    }
    loading.then((m) => setMod(m)).catch(() => {});
  }, []);

  return mod;
}

export interface RustDrink {
  volume_ml: number;
  abv: number;
  offset_secs: number;
  duration_secs: number;
  stomach_state: "empty" | "some_food" | "full";
}

export interface RustProfile {
  weight_kg: number;
  biological_sex: "male" | "female" | "other";
  height_cm: number;
  age: number;
}

export interface RustCurvePoint {
  offset_secs: number;
  bac: number;
  zone: string;
}

/**
 * Default drinking pace used by static feature visualisations.
 * Mirrors the simulator's initial slider position.
 */
export const DEFAULT_VIZ_PACE = 0.5;

/**
 * Fill in `duration_secs` for each drink using the drinking-time
 * formula, capping at the gap to the next drink so drinks never
 * overlap their successor.
 */
export function withPace(
  drinks: RustDrink[],
  pace: number = DEFAULT_VIZ_PACE,
): RustDrink[] {
  const sorted = [...drinks].sort((a, b) => a.offset_secs - b.offset_secs);
  return sorted.map((d, i) => {
    const computed = drinkingTimeSecs(d.volume_ml, d.abv, pace);
    const next = sorted[i + 1];
    const duration = next
      ? Math.min(computed, next.offset_secs - d.offset_secs)
      : computed;
    return { ...d, duration_secs: duration };
  });
}
