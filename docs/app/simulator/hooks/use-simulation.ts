import { useReducer, useEffect, useRef, useMemo, useCallback, useState } from "react";
import type { SimState, SimAction, BACDataPoint, ZoneName, BiologicalSex } from "../lib/types";
import * as tsBac from "../lib/bac";
import * as wasmBac from "../lib/bac-wasm";

const WINDOW_MINUTES = 180;

export const BODY_PROFILES: Record<
  BiologicalSex,
  { weightKg: number; heightCm: number }
> = {
  male: { weightKg: 85, heightCm: 178 },
  female: { weightKg: 70, heightCm: 165 },
};

const DEFAULT_STATE: SimState = {
  drinks: [],
  simMinute: 0,
  isRunning: false,
  speedMultiplier: 5,
  sexMode: "male",
  age: 35,
  stomachKa: 4.0,
  drinkPace: 0.5,
};

let nextDrinkId = 1;

function simReducer(state: SimState, action: SimAction): SimState {
  switch (action.type) {
    case "ADD_DRINK":
      return {
        ...state,
        isRunning: true,
        drinks: [
          ...state.drinks,
          {
            ...action.drink,
            id: String(nextDrinkId++),
            loggedAtMinute: state.simMinute,
          },
        ],
      };
    case "TICK": {
      if (!state.isRunning) return state;
      const clampedDelta = Math.min(action.deltaMs, 100);
      const simDelta = (clampedDelta / 1000) * state.speedMultiplier;
      const newMinute = state.simMinute + simDelta;

      let drinks = state.drinks;
      if (drinks.length > 1 && Math.floor(newMinute / 60) > Math.floor(state.simMinute / 60)) {
        const sorted = drinks.slice().sort((a, b) => a.loggedAtMinute - b.loggedAtMinute);
        const { weightKg, heightCm } = BODY_PROFILES.male;
        const tbw = tsBac.totalBodyWater(weightKg, heightCm, state.age, "male");
        if (tbw > 0) {
          const sessionStart = tsBac.findSessionStart(sorted, tbw, state.stomachKa);
          if (sessionStart > 0) {
            drinks = sorted.slice(sessionStart);
          }
        }
      }

      return { ...state, drinks, simMinute: newMinute };
    }
    case "SET_SPEED":
      return { ...state, speedMultiplier: action.speed };
    case "TOGGLE_PAUSE":
      return { ...state, isRunning: !state.isRunning };
    case "SET_SEX":
      return { ...state, sexMode: action.sex };
    case "SET_PACE":
      return { ...state, drinkPace: action.pace };
    case "RESET":
      nextDrinkId = 1;
      return { ...state, drinks: [], simMinute: 0, isRunning: false };
    default:
      return state;
  }
}

export interface CurveSet {
  sex: BiologicalSex;
  data: BACDataPoint[];
  currentBAC: number;
  currentZone: ZoneName;
  minutesUntilSober: number;
  weightKg: number;
  heightCm: number;
}

export interface SimulationResult {
  state: SimState;
  dispatch: React.Dispatch<SimAction>;
  curves: CurveSet[];
  windowStart: number;
  windowEnd: number;
  wasmReady: boolean;
}

function buildCurve(
  state: SimState,
  sex: BiologicalSex,
  windowStart: number,
  windowEnd: number,
  useWasm: boolean,
): CurveSet {
  const bac = useWasm ? wasmBac : tsBac;
  const { weightKg, heightCm } = BODY_PROFILES[sex];
  const currentBAC = bac.calculateBAC(
    state.drinks,
    state.simMinute,
    weightKg,
    heightCm,
    state.age,
    sex,
    state.stomachKa,
    state.drinkPace,
  );
  const data = bac.generateCurve(
    state.drinks,
    Math.floor(windowStart),
    Math.ceil(windowEnd),
    1,
    weightKg,
    heightCm,
    state.age,
    sex,
    state.stomachKa,
    state.drinkPace,
  );
  const soberIn = bac.minutesUntilSober(
    state.drinks,
    state.simMinute,
    weightKg,
    heightCm,
    state.age,
    sex,
    state.stomachKa,
    state.drinkPace,
  );
  return { sex, data, currentBAC, currentZone: bac.getZone(currentBAC), minutesUntilSober: soberIn, weightKg, heightCm };
}

export function useSimulation(): SimulationResult {
  const [state, dispatch] = useReducer(simReducer, DEFAULT_STATE);
  const [wasmReady, setWasmReady] = useState(false);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);
  const smoothWindowStartRef = useRef<number>(0);

  useEffect(() => {
    wasmBac.initWasm().then(() => setWasmReady(true)).catch(() => {});
  }, []);

  const TICK_INTERVAL = 60;

  const stableDispatch = useCallback(
    (action: SimAction) => dispatch(action),
    [],
  );

  useEffect(() => {
    const tick = (now: number) => {
      if (lastTimeRef.current > 0) {
        const deltaMs = now - lastTimeRef.current;
        accumulatedRef.current += deltaMs;
        if (accumulatedRef.current >= TICK_INTERVAL) {
          stableDispatch({ type: "TICK", deltaMs: accumulatedRef.current });
          accumulatedRef.current = 0;
        }
      }
      lastTimeRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = 0;
      accumulatedRef.current = 0;
    };
  }, [stableDispatch]);

  const targetWindowStart = useMemo(() => {
    if (state.simMinute <= WINDOW_MINUTES * 0.8) return 0;
    return state.simMinute - WINDOW_MINUTES * 0.8;
  }, [state.simMinute]);

  const currentSmooth = smoothWindowStartRef.current;
  const lerpFactor = 0.08;
  const newSmooth =
    Math.abs(targetWindowStart - currentSmooth) < 0.5
      ? targetWindowStart
      : currentSmooth + (targetWindowStart - currentSmooth) * lerpFactor;
  smoothWindowStartRef.current = newSmooth;

  const windowStart = newSmooth;
  const windowEnd = windowStart + WINDOW_MINUTES;

  const quantizedMinute = Math.floor(state.simMinute);
  const curves = useMemo(() => {
    const sexes: BiologicalSex[] =
      state.sexMode === "both" ? ["male", "female"] : [state.sexMode];
    return sexes.map((sex) => buildCurve(state, sex, windowStart, windowEnd, wasmReady));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.drinks, state.sexMode, state.age, state.stomachKa, state.drinkPace, quantizedMinute, windowStart, windowEnd, wasmReady]);

  return { state, dispatch, curves, windowStart, windowEnd, wasmReady };
}
