"use client";

import type { SexMode } from "@/app/simulator/lib/types";
import { ZONE_COLORS, getZone } from "@/app/simulator/lib/bac";
import type { PlannerAction, PlannerCurveSet } from "../hooks/use-planner";

type BACUnit = "percent" | "permille";

function lerpData(data: { minute: number; bac: number }[], minute: number): number {
  if (data.length === 0) return 0;
  if (minute <= data[0].minute) return data[0].bac;
  if (minute >= data[data.length - 1].minute) return data[data.length - 1].bac;
  for (let i = 1; i < data.length; i++) {
    if (data[i].minute >= minute) {
      const prev = data[i - 1];
      const curr = data[i];
      const t = (minute - prev.minute) / (curr.minute - prev.minute);
      return prev.bac + (curr.bac - prev.bac) * t;
    }
  }
  return data[data.length - 1].bac;
}

interface PlannerControlsProps {
  curves: PlannerCurveSet[];
  sexMode: SexMode;
  drinkPace: number;
  unit: BACUnit;
  probeMinute: number | null;
  onUnitChange: (unit: BACUnit) => void;
  dispatch: React.Dispatch<PlannerAction>;
}

const SEX_OPTIONS: { value: SexMode; label: string }[] = [
  { value: "male", label: "\u2642 Male" },
  { value: "female", label: "\u2640 Female" },
  { value: "both", label: "Both" },
];

function formatTime(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function formatBAC(bac: number, unit: BACUnit): string {
  if (unit === "permille") return (bac * 10).toFixed(2);
  return bac.toFixed(3);
}

function formatSoberTime(minutes: number): string {
  if (minutes <= 0) return "\u2014";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function PlannerControls({
  curves,
  sexMode,
  drinkPace,
  unit,
  probeMinute,
  onUnitChange,
  dispatch,
}: PlannerControlsProps) {
  const sexSymbol = (sex: string) => (sex === "male" ? "\u2642" : "\u2640");
  const isBoth = curves.length > 1;
  const isProbing = probeMinute !== null;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-end sm:justify-between">
      {/* Stats */}
      <div className={`flex items-end ${isBoth ? "gap-6" : "gap-4"}`}>
        {curves.map((c) => {
          const probedBAC = isProbing ? lerpData(c.data, probeMinute) : c.peakBAC;
          const probedZone = isProbing ? getZone(probedBAC) : c.peakZone;
          const zoneColor = ZONE_COLORS[probedZone];
          const label = isProbing ? `BAC at ${formatTime(probeMinute)}` : "Peak BAC";

          return (
            <div key={c.sex} className="flex items-start gap-3">
              {isBoth && (
                <span
                  className="mt-5 font-display text-2xl leading-none opacity-70"
                  style={{ color: zoneColor }}
                >
                  {sexSymbol(c.sex)}
                </span>
              )}
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-on-surface-variant/60">
                  {label}
                </p>
                <div className="flex items-baseline gap-2">
                  <p
                    className={`font-display font-bold tabular-nums leading-none transition-colors ${isBoth ? "text-3xl" : "text-5xl"}`}
                    style={{ color: zoneColor }}
                  >
                    {formatBAC(probedBAC, unit)}
                  </p>
                  <span className="text-sm text-on-surface-variant/40">
                    {unit === "permille" ? "\u2030" : "%"}
                  </span>
                </div>
                <div className="mt-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-on-surface-variant/40">
                    Sober in
                  </p>
                  <p
                    className="font-display text-sm font-semibold tabular-nums text-on-surface-variant/60"
                    style={{ minWidth: "4.5ch" }}
                  >
                    {formatSoberTime(c.soberAtMinute)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:items-end">
        {/* Row 1: sex + unit */}
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-outline-variant/20">
            {SEX_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => dispatch({ type: "SET_SEX", sex: opt.value })}
                className={`h-8 cursor-pointer px-2.5 text-xs font-medium transition-colors sm:px-3 ${
                  sexMode === opt.value
                    ? "bg-primary/15 text-primary"
                    : "text-on-surface-variant/60 hover:bg-surface-bright/40"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex overflow-hidden rounded-lg border border-outline-variant/20">
            <button
              onClick={() => onUnitChange("percent")}
              className={`h-8 cursor-pointer px-3 text-xs font-medium transition-colors ${
                unit === "percent"
                  ? "bg-primary/15 text-primary"
                  : "text-on-surface-variant/60 hover:bg-surface-bright/40"
              }`}
            >
              %
            </button>
            <button
              onClick={() => onUnitChange("permille")}
              className={`h-8 cursor-pointer px-3 text-xs font-medium transition-colors ${
                unit === "permille"
                  ? "bg-primary/15 text-primary"
                  : "text-on-surface-variant/60 hover:bg-surface-bright/40"
              }`}
            >
              {"\u2030"}
            </button>
          </div>
        </div>

        {/* Row 2: pace slider */}
        <label className="flex h-8 w-full items-center gap-2 rounded-lg border border-outline-variant/20 px-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-on-surface-variant/60">
            pace
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-on-surface-variant/40">
            instant
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={drinkPace}
            onChange={(e) =>
              dispatch({ type: "SET_PACE", pace: Number(e.target.value) })
            }
            className="min-w-0 flex-1 accent-primary"
          />
          <span className="text-[10px] font-medium uppercase tracking-wider text-on-surface-variant/40">
            slow
          </span>
        </label>

        {/* Row 3: reset */}
        <button
          onClick={() => dispatch({ type: "RESET" })}
          className="flex h-8 cursor-pointer items-center justify-center self-end rounded-lg border border-outline-variant/20 px-3 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-bright/40"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}
