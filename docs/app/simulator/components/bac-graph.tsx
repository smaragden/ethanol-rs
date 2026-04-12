"use client";

import { useRef, useEffect, useCallback } from "react";
import type { SimDrink } from "../lib/types";
import type { BACUnit } from "./simulator";
import { renderGraph, type CurveRenderData } from "../lib/graph-renderer";

interface BACGraphProps {
  curves: CurveRenderData[];
  currentMinute: number;
  windowStart: number;
  windowEnd: number;
  drinks: SimDrink[];
  unit: BACUnit;
}

export function BACGraph({
  curves,
  currentMinute,
  windowStart,
  windowEnd,
  drinks,
  unit,
}: BACGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    renderGraph(ctx, curves, currentMinute, windowStart, windowEnd, drinks, w, h, unit);
  }, [curves, currentMinute, windowStart, windowEnd, drinks, unit]);

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

  return (
    <div
      ref={containerRef}
      className="relative h-[300px] w-full overflow-hidden rounded-2xl bg-surface/60 p-1 backdrop-blur-xl sm:h-[360px]"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
