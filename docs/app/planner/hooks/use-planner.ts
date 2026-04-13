"use client";

import { useReducer, useEffect, useMemo, useState } from "react";
import type { SimDrink, BiologicalSex, SexMode, BACDataPoint, ZoneName } from "@/app/simulator/lib/types";
import * as tsBac from "@/app/simulator/lib/bac";
import * as wasmBac from "@/app/simulator/lib/bac-wasm";

const BODY_PROFILES: Record<BiologicalSex, { weightKg: number; heightCm: number }> = {
  male: { weightKg: 85, heightCm: 178 },
  female: { weightKg: 70, heightCm: 165 },
};

const DEFAULT_AGE = 35;
const DEFAULT_PACE = 0.5;
const STOMACH_KA = 4.0;
const MIN_WINDOW = 120;

export interface PlannerState {
  drinks: SimDrink[];
  sexMode: SexMode;
  age: number;
  drinkPace: number;
}

export type PlannerAction =
  | { type: "ADD_DRINK"; drink: Pick<SimDrink, "name" | "volumeMl" | "abv">; atMinute: number }
  | { type: "MOVE_DRINK"; id: string; toMinute: number }
  | { type: "REMOVE_DRINK"; id: string }
  | { type: "SET_SEX"; sex: SexMode }
  | { type: "SET_PACE"; pace: number }
  | { type: "RESET" };

let nextId = 1;

function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case "ADD_DRINK":
      return {
        ...state,
        drinks: [
          ...state.drinks,
          {
            ...action.drink,
            id: String(nextId++),
            loggedAtMinute: action.atMinute,
          },
        ],
      };
    case "MOVE_DRINK":
      return {
        ...state,
        drinks: state.drinks.map((d) =>
          d.id === action.id ? { ...d, loggedAtMinute: Math.max(0, action.toMinute) } : d,
        ),
      };
    case "REMOVE_DRINK":
      return {
        ...state,
        drinks: state.drinks.filter((d) => d.id !== action.id),
      };
    case "SET_SEX":
      return { ...state, sexMode: action.sex };
    case "SET_PACE":
      return { ...state, drinkPace: action.pace };
    case "RESET":
      nextId = 1;
      return { ...state, drinks: [] };
    default:
      return state;
  }
}

export interface PlannerCurveSet {
  sex: BiologicalSex;
  data: BACDataPoint[];
  peakBAC: number;
  peakZone: ZoneName;
  soberAtMinute: number;
  weightKg: number;
  heightCm: number;
}

/**
 * Split drinks into sessions. A new session starts when the BAC from
 * all previous drinks in the current session has fully metabolised
 * before the next drink.
 */
function splitSessions(
  drinks: SimDrink[],
  weightKg: number,
  heightCm: number,
  age: number,
  sex: BiologicalSex,
): SimDrink[][] {
  if (drinks.length === 0) return [];
  const sorted = [...drinks].sort((a, b) => a.loggedAtMinute - b.loggedAtMinute);
  const sessions: SimDrink[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const currentSession = sessions[sessions.length - 1];
    // Skip boundary check when drinks are at the same time — absorption
    // hasn't started yet so BAC would be near-zero, falsely splitting them.
    const gapMinutes = sorted[i].loggedAtMinute - sorted[i - 1].loggedAtMinute;
    if (gapMinutes < 1) {
      currentSession.push(sorted[i]);
      continue;
    }

    // Check if BAC from the current session's drinks is still > 0
    // at the time of the next drink
    const bacAtNext = tsBac.calculateBAC(
      currentSession,
      sorted[i].loggedAtMinute,
      weightKg, heightCm, age, sex, STOMACH_KA, 0.5,
    );

    if (bacAtNext <= 0.001) {
      sessions.push([sorted[i]]);
    } else {
      currentSession.push(sorted[i]);
    }
  }
  return sessions;
}

function buildPlannerCurve(
  drinks: SimDrink[],
  sex: BiologicalSex,
  age: number,
  drinkPace: number,
  windowEnd: number,
  useWasm: boolean,
): PlannerCurveSet {
  const bac = useWasm ? wasmBac : tsBac;
  const { weightKg, heightCm } = BODY_PROFILES[sex];

  if (drinks.length === 0) {
    const data: BACDataPoint[] = [];
    for (let m = 0; m <= Math.ceil(windowEnd); m++) {
      data.push({ minute: m, bac: 0, zone: "sober" });
    }
    return { sex, data, peakBAC: 0, peakZone: "sober", soberAtMinute: 0, weightKg, heightCm };
  }

  // Split into sessions so each generateCurve call only sees one session's drinks
  const sessions = splitSessions(drinks, weightKg, heightCm, age, sex);
  const allData: BACDataPoint[] = [];
  let lastMinute = 0;

  for (let si = 0; si < sessions.length; si++) {
    const session = sessions[si];
    const sessionStart = Math.floor(session[0].loggedAtMinute);
    const nextSessionStart = si < sessions.length - 1
      ? Math.floor(sessions[si + 1][0].loggedAtMinute)
      : Math.ceil(windowEnd);

    // Fill gap before this session with zeros
    for (let m = lastMinute; m < sessionStart; m++) {
      allData.push({ minute: m, bac: 0, zone: "sober" });
    }

    // Generate curve for this session
    const sessionData = bac.generateCurve(
      session, sessionStart, nextSessionStart, 1,
      weightKg, heightCm, age, sex, STOMACH_KA, drinkPace,
    );
    allData.push(...sessionData);
    lastMinute = nextSessionStart + 1;
  }

  // Fill remaining with zeros
  for (let m = lastMinute; m <= Math.ceil(windowEnd); m++) {
    allData.push({ minute: m, bac: 0, zone: "sober" });
  }

  let peakBAC = 0;
  for (const p of allData) {
    if (p.bac > peakBAC) peakBAC = p.bac;
  }

  // Sober time from the last session
  const lastSession = sessions[sessions.length - 1];
  const soberMinutes = bac.minutesUntilSober(
    lastSession, lastSession[0].loggedAtMinute,
    weightKg, heightCm, age, sex, STOMACH_KA, drinkPace,
  );
  const soberAtMinute = lastSession[0].loggedAtMinute + soberMinutes;

  return {
    sex,
    data: allData,
    peakBAC,
    peakZone: bac.getZone(peakBAC),
    soberAtMinute,
    weightKg,
    heightCm,
  };
}

/**
 * Compute curves from a given drinks array and planner settings.
 * Separated from state management so it can be called with drag-overridden drinks.
 */
export function usePlannerCurves(
  drinks: SimDrink[],
  sexMode: SexMode,
  age: number,
  drinkPace: number,
  wasmReady: boolean,
): { curves: PlannerCurveSet[]; windowEnd: number } {
  const roughWindowEnd = useMemo(() => {
    if (drinks.length === 0) return MIN_WINDOW;
    const lastDrink = Math.max(...drinks.map((d) => d.loggedAtMinute));
    return Math.max(MIN_WINDOW, lastDrink + 300);
  }, [drinks]);

  const curves = useMemo(() => {
    const sexes: BiologicalSex[] =
      sexMode === "both" ? ["male", "female"] : [sexMode];
    return sexes.map((sex) =>
      buildPlannerCurve(drinks, sex, age, drinkPace, roughWindowEnd, wasmReady),
    );
  }, [drinks, sexMode, age, drinkPace, roughWindowEnd, wasmReady]);

  const windowEnd = useMemo(() => {
    if (drinks.length === 0) return MIN_WINDOW;
    const maxSober = Math.max(...curves.map((c) => c.soberAtMinute));
    const lastDrink = Math.max(...drinks.map((d) => d.loggedAtMinute));
    return Math.max(MIN_WINDOW, maxSober + 30, lastDrink + 60);
  }, [curves, drinks]);

  return { curves, windowEnd };
}

export function usePlannerState() {
  const [state, dispatch] = useReducer(plannerReducer, {
    drinks: [],
    sexMode: "male",
    age: DEFAULT_AGE,
    drinkPace: DEFAULT_PACE,
  });
  const [wasmReady, setWasmReady] = useState(false);

  useEffect(() => {
    wasmBac.initWasm().then(() => setWasmReady(true)).catch(() => {});
  }, []);

  return { state, dispatch, wasmReady };
}
