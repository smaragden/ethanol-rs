import type { SimDrink, BACDataPoint, ZoneName, BiologicalSex } from "./types";

const ETHANOL_DENSITY = 0.789;
const METABOLISM_RATE = 0.015;

export function alcoholGrams(volumeMl: number, abv: number): number {
  return volumeMl * abv * ETHANOL_DENSITY;
}

export function totalBodyWater(
  weightKg: number,
  heightCm: number,
  age: number,
  sex: BiologicalSex,
): number {
  if (sex === "male") {
    return 2.447 - 0.09516 * age + 0.1074 * heightCm + 0.3362 * weightKg;
  }
  return -2.097 + 0.1069 * heightCm + 0.2466 * weightKg;
}

function drinkRawBAC(
  drink: SimDrink,
  atMinute: number,
  tbw: number,
  stomachKa: number,
): number {
  const hours = (atMinute - drink.loggedAtMinute) / 60;
  if (hours <= 0) return 0;
  const absorbed =
    alcoholGrams(drink.volumeMl, drink.abv) * (1 - Math.exp(-stomachKa * hours));
  return (absorbed / (tbw * 800)) * 100;
}

export function findSessionStart(
  sorted: SimDrink[],
  tbw: number,
  stomachKa: number,
): number {
  let sessionStart = 0;
  for (let i = 1; i < sorted.length; i++) {
    const checkTime = sorted[i].loggedAtMinute;
    // Skip boundary check when drinks are at the same time — absorption
    // hasn't started yet so BAC would be near-zero, falsely splitting them.
    const gapMinutes = checkTime - sorted[i - 1].loggedAtMinute;
    if (gapMinutes < 1) continue;

    let rawBAC = 0;
    for (let j = sessionStart; j < i; j++) {
      rawBAC += drinkRawBAC(sorted[j], checkTime, tbw, stomachKa);
    }
    const metabHours = (checkTime - sorted[sessionStart].loggedAtMinute) / 60;
    if (rawBAC - metabHours * METABOLISM_RATE <= 0.001) {
      sessionStart = i;
    }
  }
  return sessionStart;
}

function calculateBACFast(
  sorted: SimDrink[],
  activeStartIndex: number,
  atMinute: number,
  tbw: number,
  stomachKa: number,
): number {
  if (sorted.length === 0) return 0;

  let end = sorted.length;
  while (end > 0 && sorted[end - 1].loggedAtMinute >= atMinute) end--;
  if (end <= activeStartIndex) return 0;

  let totalBAC = 0;
  for (let i = activeStartIndex; i < end; i++) {
    totalBAC += drinkRawBAC(sorted[i], atMinute, tbw, stomachKa);
  }

  const metabolismHours =
    (atMinute - sorted[activeStartIndex].loggedAtMinute) / 60;
  totalBAC -= metabolismHours * METABOLISM_RATE;

  return Math.max(0, totalBAC);
}

export function calculateBAC(
  drinks: SimDrink[],
  atMinute: number,
  weightKg: number,
  heightCm: number,
  age: number,
  sex: BiologicalSex,
  stomachKa: number,
  _drinkPace: number = 0,
): number {
  if (drinks.length === 0) return 0;

  const tbw = totalBodyWater(weightKg, heightCm, age, sex);
  if (tbw <= 0) return 0;

  const sorted = drinks
    .filter((d) => d.loggedAtMinute < atMinute)
    .sort((a, b) => a.loggedAtMinute - b.loggedAtMinute);

  if (sorted.length === 0) return 0;

  const sessionStart = findSessionStart(sorted, tbw, stomachKa);

  return calculateBACFast(sorted, sessionStart, atMinute, tbw, stomachKa);
}

export function getZone(bac: number): ZoneName {
  if (bac <= 0.001) return "sober";
  if (bac < 0.06) return "belowSweetSpot";
  if (bac <= 0.09) return "sweetSpot";
  if (bac <= 0.1) return "caution";
  return "danger";
}

export const ZONE_COLORS: Record<ZoneName, string> = {
  sober: "#adaaaa",
  belowSweetSpot: "#69f6b8",
  sweetSpot: "#69f6b8",
  caution: "#f8a010",
  danger: "#ff716a",
};

export function minutesUntilSober(
  drinks: SimDrink[],
  fromMinute: number,
  weightKg: number,
  heightCm: number,
  age: number,
  sex: BiologicalSex,
  stomachKa: number,
  _drinkPace: number = 0,
): number {
  if (drinks.length === 0) return 0;

  const tbw = totalBodyWater(weightKg, heightCm, age, sex);
  if (tbw <= 0) return 0;

  const sorted = drinks
    .slice()
    .sort((a, b) => a.loggedAtMinute - b.loggedAtMinute);
  const sessionStart = findSessionStart(sorted, tbw, stomachKa);

  const currentBAC = calculateBACFast(sorted, sessionStart, fromMinute, tbw, stomachKa);
  if (currentBAC <= 0.001) return 0;

  const maxScan = Math.ceil((currentBAC / METABOLISM_RATE) * 60) + 120;

  const coarseStep = 5;
  let coarseMinute = coarseStep;
  for (; coarseMinute <= maxScan; coarseMinute += coarseStep) {
    const bac = calculateBACFast(sorted, sessionStart, fromMinute + coarseMinute, tbw, stomachKa);
    if (bac <= 0.001) break;
  }

  const fineStart = Math.max(1, coarseMinute - coarseStep);
  for (let m = fineStart; m <= Math.min(coarseMinute, maxScan); m++) {
    const bac = calculateBACFast(sorted, sessionStart, fromMinute + m, tbw, stomachKa);
    if (bac <= 0.001) return m;
  }
  return Math.min(coarseMinute, maxScan);
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
  _drinkPace: number = 0,
): BACDataPoint[] {
  if (drinks.length === 0) {
    const points: BACDataPoint[] = [];
    for (let m = fromMinute; m <= toMinute; m += stepMinutes) {
      points.push({ minute: m, bac: 0, zone: "sober" });
    }
    return points;
  }

  const tbw = totalBodyWater(weightKg, heightCm, age, sex);
  if (tbw <= 0) return [];

  const sorted = drinks
    .slice()
    .sort((a, b) => a.loggedAtMinute - b.loggedAtMinute);
  const sessionStart = findSessionStart(sorted, tbw, stomachKa);

  const points: BACDataPoint[] = [];
  for (let m = fromMinute; m <= toMinute; m += stepMinutes) {
    const bac = calculateBACFast(sorted, sessionStart, m, tbw, stomachKa);
    points.push({ minute: m, bac, zone: getZone(bac) });
  }
  return points;
}
