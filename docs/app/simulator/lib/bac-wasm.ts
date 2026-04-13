import type { SimDrink, BACDataPoint, ZoneName, BiologicalSex } from "./types";
import { drinkingTimeSecs } from "./drinking-time";

type WasmModule = typeof import("@/lib/wasm/ethanol-rs-wasm/ethanol_rs_wasm");

let wasmModule: WasmModule | null = null;
let wasmLoading: Promise<WasmModule> | null = null;

export function isWasmReady(): boolean {
  return wasmModule !== null;
}

export function initWasm(): Promise<WasmModule> {
  if (wasmModule) return Promise.resolve(wasmModule);
  if (wasmLoading) return wasmLoading;

  wasmLoading = import("@/lib/wasm/ethanol-rs-wasm/ethanol_rs_wasm").then((mod) => {
    wasmModule = mod;
    return mod;
  });
  return wasmLoading;
}

const ZONE_MAP: Record<string, ZoneName> = {
  sober: "sober",
  below_sweet_spot: "belowSweetSpot",
  sweet_spot: "sweetSpot",
  caution: "caution",
  danger: "danger",
};

function stomachStateFromKa(ka: number): string {
  if (ka <= 1.5) return "full";
  if (ka <= 2.5) return "some_food";
  return "empty";
}

function toRustDrinks(
  drinks: SimDrink[],
  refMinute: number,
  stomachKa: number,
  drinkPace: number,
) {
  // Sort by log time so we can cap each drink's duration at the gap
  // to the next drink — no drink overlaps its successor.
  // When drinks share the same timestamp, keep the full computed duration
  // (parallel sipping) so the absorption model doesn't degenerate.
  const sorted = [...drinks].sort(
    (a, b) => a.loggedAtMinute - b.loggedAtMinute,
  );
  return sorted.map((d, i) => {
    const computed = drinkingTimeSecs(d.volumeMl, d.abv, drinkPace);
    const next = sorted[i + 1];
    const gapSecs = next ? (next.loggedAtMinute - d.loggedAtMinute) * 60 : Infinity;
    const durationSecs = gapSecs > 0 ? Math.min(computed, gapSecs) : computed;
    return {
      volume_ml: d.volumeMl,
      abv: d.abv,
      offset_secs: (d.loggedAtMinute - refMinute) * 60,
      duration_secs: durationSecs,
      stomach_state: stomachStateFromKa(stomachKa),
    };
  });
}

function toRustProfile(weightKg: number, heightCm: number, age: number, sex: BiologicalSex) {
  return {
    weight_kg: weightKg,
    biological_sex: sex,
    height_cm: heightCm,
    age,
  };
}

export function calculateBAC(
  drinks: SimDrink[],
  atMinute: number,
  weightKg: number,
  heightCm: number,
  age: number,
  sex: BiologicalSex,
  stomachKa: number,
  drinkPace: number,
): number {
  if (!wasmModule || drinks.length === 0) return 0;

  return wasmModule.calculateBAC(
    toRustDrinks(drinks, atMinute, stomachKa, drinkPace),
    toRustProfile(weightKg, heightCm, age, sex),
    "watson",
  );
}

export function generateCurve(
  drinks: SimDrink[],
  fromMinute: number,
  toMinute: number,
  stepMinutes: number,
  weightKg: number,
  heightCm: number,
  age: number,
  sex: BiologicalSex,
  stomachKa: number,
  drinkPace: number,
): BACDataPoint[] {
  if (!wasmModule) return [];

  if (drinks.length === 0) {
    const points: BACDataPoint[] = [];
    for (let m = fromMinute; m <= toMinute; m += stepMinutes) {
      points.push({ minute: m, bac: 0, zone: "sober" });
    }
    return points;
  }

  const refMinute = 0;
  const fromOffsetSecs = fromMinute * 60;
  const toOffsetSecs = toMinute * 60;
  const stepSecs = stepMinutes * 60;

  const rawPoints = wasmModule.generateCurve(
    toRustDrinks(drinks, refMinute, stomachKa, drinkPace),
    toRustProfile(weightKg, heightCm, age, sex),
    "watson",
    fromOffsetSecs,
    toOffsetSecs,
    stepSecs,
    0.06,
    0.09,
  ) as Array<{ offset_secs: number; bac: number; zone: string }>;

  return rawPoints.map((p) => ({
    minute: p.offset_secs / 60,
    bac: p.bac,
    zone: ZONE_MAP[p.zone] ?? "sober",
  }));
}

export function minutesUntilSober(
  drinks: SimDrink[],
  fromMinute: number,
  weightKg: number,
  heightCm: number,
  age: number,
  sex: BiologicalSex,
  stomachKa: number,
  drinkPace: number,
): number {
  if (!wasmModule || drinks.length === 0) return 0;

  return wasmModule.minutesUntilSober(
    toRustDrinks(drinks, fromMinute, stomachKa, drinkPace),
    toRustProfile(weightKg, heightCm, age, sex),
    "watson",
  );
}

export function getZone(bac: number): ZoneName {
  if (!wasmModule) return "sober";
  const z = wasmModule.classifyZone(bac, 0.06, 0.09) as string;
  return ZONE_MAP[z] ?? "sober";
}
