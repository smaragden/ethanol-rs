"use client";

import { useRef, useEffect, useCallback } from "react";

export interface ChartPoint {
  minute: number;
  bac: number;
}

export interface ChartSeries {
  label: string;
  color: string;
  points: ChartPoint[];
  dashed?: boolean;
}

export interface Annotation {
  minute: number;
  label: string;
  color?: string;
}

interface CurveChartProps {
  series: ChartSeries[];
  xMax: number;
  yMax?: number;
  height?: number;
  annotations?: Annotation[];
  showZones?: boolean;
  bacUnit?: "percent" | "permille";
}

const PADDING_LEFT = 44;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 28;

const ZONE_BANDS = [
  { min: 0.06, max: 0.09, color: "#69f6b8", alpha: 0.09 },
  { min: 0.09, max: 0.1, color: "#f8a010", alpha: 0.08 },
  { min: 0.1, max: 0.25, color: "#ff716a", alpha: 0.06 },
];

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function CurveChart({
  series,
  xMax,
  yMax,
  height = 220,
  annotations = [],
  showZones = false,
  bacUnit = "percent",
}: CurveChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const peak = Math.max(
    0.02,
    ...series.flatMap((s) => s.points.map((p) => p.bac)),
  );
  const effectiveYMax = yMax ?? Math.max(0.1, peak * 1.25);

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

    const plotW = w - PADDING_LEFT - PADDING_RIGHT;
    const plotH = h - PADDING_TOP - PADDING_BOTTOM;

    const toX = (minute: number) =>
      PADDING_LEFT + (minute / xMax) * plotW;
    const toY = (bac: number) =>
      PADDING_TOP + plotH - (bac / effectiveYMax) * plotH;

    ctx.clearRect(0, 0, w, h);

    if (showZones) {
      for (const band of ZONE_BANDS) {
        if (band.min >= effectiveYMax) continue;
        const y1 = toY(Math.min(band.max, effectiveYMax));
        const y2 = toY(band.min);
        ctx.fillStyle = hexToRgba(band.color, band.alpha);
        ctx.fillRect(PADDING_LEFT, y1, plotW, y2 - y1);
      }
    }

    // Gridlines + y labels
    ctx.font = '10px "Space Grotesk", sans-serif';
    ctx.fillStyle = "#6c6c6c";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const bacStep = effectiveYMax <= 0.12 ? 0.02 : 0.05;
    for (let bac = 0; bac <= effectiveYMax + 0.0001; bac += bacStep) {
      const y = toY(bac);
      ctx.strokeStyle = "rgba(80, 80, 80, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PADDING_LEFT, y);
      ctx.lineTo(w - PADDING_RIGHT, y);
      ctx.stroke();
      const label =
        bacUnit === "permille" ? (bac * 10).toFixed(1) : bac.toFixed(2);
      ctx.fillText(label, PADDING_LEFT - 6, y);
    }

    // X labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xStep = xMax <= 120 ? 30 : xMax <= 360 ? 60 : 120;
    for (let m = 0; m <= xMax; m += xStep) {
      const x = toX(m);
      ctx.strokeStyle = "rgba(80, 80, 80, 0.15)";
      ctx.beginPath();
      ctx.moveTo(x, PADDING_TOP);
      ctx.lineTo(x, h - PADDING_BOTTOM);
      ctx.stroke();
      const h_ = Math.floor(m / 60);
      const min = m % 60;
      const label =
        min === 0 ? `${h_}h` : `${h_}:${min.toString().padStart(2, "0")}`;
      ctx.fillStyle = "#6c6c6c";
      ctx.fillText(label, x, h - PADDING_BOTTOM + 6);
    }

    // Annotations (vertical)
    for (const ann of annotations) {
      const x = toX(ann.minute);
      ctx.strokeStyle = hexToRgba(ann.color ?? "#adaaaa", 0.5);
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, PADDING_TOP);
      ctx.lineTo(x, h - PADDING_BOTTOM);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hexToRgba(ann.color ?? "#adaaaa", 0.75);
      ctx.font = '10px "Space Grotesk", sans-serif';
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(ann.label, x + 3, PADDING_TOP + 2);
    }

    // Curves
    for (const s of series) {
      if (s.points.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (s.dashed) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(toX(s.points[0].minute), toY(s.points[0].bac));
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(toX(s.points[i].minute), toY(s.points[i].bac));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Baseline
    ctx.strokeStyle = "rgba(80, 80, 80, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING_LEFT, toY(0));
    ctx.lineTo(w - PADDING_RIGHT, toY(0));
    ctx.stroke();
  }, [series, xMax, effectiveYMax, annotations, showZones, bacUnit]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => draw());
    obs.observe(container);
    return () => obs.disconnect();
  }, [draw]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl bg-surface/60"
        style={{ height }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
      {series.length > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-on-surface-variant/70">
          {series.map((s, i) => (
            <div
              key={`legend-${i}`}
              className="flex items-center gap-1.5"
            >
              <span
                key="swatch"
                aria-hidden
                className="inline-block h-[3px] w-5 rounded"
                style={{
                  backgroundColor: s.color,
                  borderTop: s.dashed ? `2px dashed ${s.color}` : undefined,
                }}
              />
              <span key="label">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
