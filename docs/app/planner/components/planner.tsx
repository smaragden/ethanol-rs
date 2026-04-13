"use client";

import { useState, useMemo, useCallback } from "react";
import { usePlannerState, usePlannerCurves } from "../hooks/use-planner";
import { PlannerControls } from "./planner-controls";
import { PlannerGraph } from "./planner-graph";
import { PlannerDrinkButtons } from "./planner-drink-buttons";

type BACUnit = "percent" | "permille";

export function Planner() {
  const [unit, setUnit] = useState<BACUnit>("permille");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragMinute, setDragMinute] = useState<number | null>(null);
  const [probeMinute, setProbeMinute] = useState<number | null>(null);

  const { state, dispatch, wasmReady } = usePlannerState();

  // Override dragged drink's position for live curve preview
  const effectiveDrinks = useMemo(() => {
    if (dragId === null || dragMinute === null) return state.drinks;
    return state.drinks.map((d) =>
      d.id === dragId ? { ...d, loggedAtMinute: dragMinute } : d,
    );
  }, [state.drinks, dragId, dragMinute]);

  // Curves computed from effective drinks — updates live during drag
  const { curves, windowEnd } = usePlannerCurves(
    effectiveDrinks,
    state.sexMode,
    state.age,
    state.drinkPace,
    wasmReady,
  );

  const curveRenderData = useMemo(
    () => curves.map((c) => ({ sex: c.sex, data: c.data })),
    [curves],
  );

  const nextMinute = useMemo(() => {
    if (state.drinks.length === 0) return 0;
    return Math.max(...state.drinks.map((d) => d.loggedAtMinute)) + 30;
  }, [state.drinks]);

  const handleMoveDrink = useCallback(
    (id: string, toMinute: number) => {
      dispatch({ type: "MOVE_DRINK", id, toMinute });
      setDragId(null);
      setDragMinute(null);
    },
    [dispatch],
  );

  const handleRemoveDrink = useCallback(
    (id: string) => {
      dispatch({ type: "REMOVE_DRINK", id });
    },
    [dispatch],
  );

  const handleDrag = useCallback((id: string, minute: number) => {
    setDragId(id);
    setDragMinute(minute);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragMinute(null);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <PlannerControls
        curves={curves}
        sexMode={state.sexMode}
        drinkPace={state.drinkPace}
        unit={unit}
        probeMinute={probeMinute}
        onUnitChange={setUnit}
        dispatch={dispatch}
      />
      <PlannerGraph
        curves={curveRenderData}
        windowEnd={windowEnd}
        drinks={effectiveDrinks}
        unit={unit}
        dragId={dragId}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onMoveDrink={handleMoveDrink}
        onRemoveDrink={handleRemoveDrink}
        onProbe={setProbeMinute}
      />
      <PlannerDrinkButtons dispatch={dispatch} nextMinute={nextMinute} />
      {state.drinks.length > 0 && (
        <p className="text-center text-xs text-on-surface-variant/40">
          Drag drinks to reposition &middot; Double-click to remove
        </p>
      )}
    </div>
  );
}
