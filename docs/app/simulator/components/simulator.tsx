"use client";

import { useState } from "react";
import { useSimulation } from "../hooks/use-simulation";
import { BACGraph } from "./bac-graph";
import { DrinkButtons } from "./drink-buttons";
import { SimulatorControls } from "./simulator-controls";

export type BACUnit = "percent" | "permille";

export function Simulator() {
  const { state, dispatch, curves, windowStart, windowEnd, wasmReady } = useSimulation();
  const [unit, setUnit] = useState<BACUnit>("permille");

  return (
    <div className="flex flex-col gap-6">
      <SimulatorControls
        curves={curves}
        isRunning={state.isRunning}
        speedMultiplier={state.speedMultiplier}
        simMinute={state.simMinute}
        sexMode={state.sexMode}
        drinkPace={state.drinkPace}
        unit={unit}
        onUnitChange={setUnit}
        dispatch={dispatch}
      />
      <div className="flex flex-col gap-2">
        <BACGraph
          curves={curves}
          currentMinute={state.simMinute}
          windowStart={windowStart}
          windowEnd={windowEnd}
          drinks={state.drinks}
          unit={unit}
        />
        <div className="flex items-center justify-center gap-6 text-xs tabular-nums text-on-surface-variant/40">
          {curves.map((c) => (
            <span key={c.sex}>
              {c.sex === "male" ? "\u2642" : "\u2640"} {c.weightKg} kg · {c.heightCm} cm · {state.age} yr
            </span>
          ))}
          <span className="ml-2 flex items-center gap-1 rounded-md border border-outline-variant/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase">
            {wasmReady ? "wasm" : "loading…"}
          </span>
        </div>
      </div>
      <DrinkButtons dispatch={dispatch} />
    </div>
  );
}
