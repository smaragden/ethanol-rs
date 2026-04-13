"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { SimDrink } from "@/app/simulator/lib/types";
import { renderPlannerGraph, PADDING_LEFT, PADDING_RIGHT, type CurveRenderData, type DragState } from "../lib/planner-renderer";

type BACUnit = "percent" | "permille";

interface PlannerGraphProps {
  curves: CurveRenderData[];
  windowEnd: number;
  drinks: SimDrink[];
  unit: BACUnit;
  dragId: string | null;
  onDrag: (id: string, minute: number) => void;
  onDragEnd: () => void;
  onMoveDrink: (id: string, toMinute: number) => void;
  onRemoveDrink: (id: string) => void;
  onProbe?: (minute: number | null) => void;
}

function snap(minute: number): number {
  return Math.round(minute / 5) * 5;
}

export function PlannerGraph({
  curves,
  windowEnd,
  drinks,
  unit,
  dragId,
  onDrag,
  onDragEnd,
  onMoveDrink,
  onRemoveDrink,
  onProbe,
}: PlannerGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [probeMinute, setProbeMinute] = useState<number | null>(null);
  const draggingRef = useRef<string | null>(null);
  const lastDragMinuteRef = useRef<number>(0);

  const getPlotW = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 0;
    return container.getBoundingClientRect().width - PADDING_LEFT - PADDING_RIGHT;
  }, []);

  const fromX = useCallback(
    (clientX: number): number => {
      const container = containerRef.current;
      const plotW = getPlotW();
      if (!container || plotW <= 0) return 0;
      const rect = container.getBoundingClientRect();
      const pixelX = clientX - rect.left;
      return ((pixelX - PADDING_LEFT) / plotW) * windowEnd;
    },
    [windowEnd, getPlotW],
  );

  const toX = useCallback(
    (minute: number): number => {
      const plotW = getPlotW();
      return PADDING_LEFT + (minute / windowEnd) * plotW;
    },
    [windowEnd, getPlotW],
  );

  const hitTestDrink = useCallback(
    (clientX: number): SimDrink | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const pixelX = clientX - rect.left;
      for (const drink of drinks) {
        if (Math.abs(pixelX - toX(drink.loggedAtMinute)) < 24) return drink;
      }
      return null;
    },
    [drinks, toX],
  );

  const dragState: DragState = {
    hoveredId: hoveredId ?? undefined,
    draggingId: dragId ?? undefined,
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    renderPlannerGraph(ctx, curves, windowEnd, drinks, w, h, unit, dragState, probeMinute ?? undefined);
  }, [curves, windowEnd, drinks, unit, dragState, probeMinute]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const hit = hitTestDrink(e.clientX);
      if (!hit) return;
      draggingRef.current = hit.id;
      lastDragMinuteRef.current = hit.loggedAtMinute;
      onDrag(hit.id, hit.loggedAtMinute);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [hitTestDrink, onDrag],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingRef.current) {
        const minute = snap(Math.max(0, fromX(e.clientX)));
        lastDragMinuteRef.current = minute;
        onDrag(draggingRef.current, minute);
        setProbeMinute(null);
      } else {
        const hit = hitTestDrink(e.clientX);
        setHoveredId(hit?.id ?? null);
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = hit ? "grab" : "crosshair";
        // Show probe crosshair when not hovering a drink
        const minute = Math.max(0, Math.min(windowEnd, fromX(e.clientX)));
        setProbeMinute(Math.round(minute));
        onProbe?.(Math.round(minute));
      }
    },
    [fromX, hitTestDrink, onDrag, onProbe, windowEnd],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (draggingRef.current) {
        onMoveDrink(draggingRef.current, lastDragMinuteRef.current);
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }
      draggingRef.current = null;
      onDragEnd();
    },
    [onMoveDrink, onDragEnd],
  );

  const handlePointerLeave = useCallback(() => {
    if (!draggingRef.current) {
      setProbeMinute(null);
      setHoveredId(null);
      onProbe?.(null);
    }
  }, [onProbe]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitTestDrink(e.clientX);
      if (hit) onRemoveDrink(hit.id);
    },
    [hitTestDrink, onRemoveDrink],
  );

  return (
    <div
      ref={containerRef}
      className="relative h-[300px] w-full overflow-hidden rounded-2xl bg-surface/60 p-1 backdrop-blur-xl sm:h-[360px]"
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}
