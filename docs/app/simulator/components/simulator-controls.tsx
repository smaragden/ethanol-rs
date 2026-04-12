"use client";

import type { SimAction, ZoneName, SexMode } from "../lib/types";
import type { BACUnit } from "./simulator";
import type { CurveSet } from "../hooks/use-simulation";
import { ZONE_COLORS } from "../lib/bac";

interface SimulatorControlsProps {
  curves: CurveSet[];
  isRunning: boolean;
  speedMultiplier: number;
  simMinute: number;
  sexMode: SexMode;
  drinkPace: number;
  unit: BACUnit;
  onUnitChange: (unit: BACUnit) => void;
  dispatch: React.Dispatch<SimAction>;
}

const SPEEDS: { value: number; label: string }[] = [
  { value: 1 / 60, label: "1\u00D7" },
  { value: 1, label: "1m/s" },
  { value: 5, label: "5m/s" },
  { value: 10, label: "10m/s" },
];

const SEX_OPTIONS: { value: SexMode; label: string }[] = [
  { value: "male", label: "\u2642 Male" },
  { value: "female", label: "\u2640 Female" },
  { value: "both", label: "Both" },
];

function formatClock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  const s = Math.floor((minute % 1) * 60);
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatBAC(bac: number, unit: BACUnit): string {
  if (unit === "permille") return (bac * 10).toFixed(2);
  return bac.toFixed(3);
}

function formatSoberTime(minutes: number): string {
  if (minutes <= 0) return "Now";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function SimulatorControls({
  curves,
  isRunning,
  speedMultiplier,
  simMinute,
  sexMode,
  drinkPace,
  unit,
  onUnitChange,
  dispatch,
}: SimulatorControlsProps) {
  const zoneLabel: Record<ZoneName, string> = {
    sober: "Sober",
    belowSweetSpot: "Below",
    sweetSpot: "Sweet Spot",
    caution: "Caution",
    danger: "Danger",
  };

  const sexSymbol = (sex: string) => (sex === "male" ? "\u2642" : "\u2640");
  const isBoth = curves.length > 1;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className={`flex items-end ${isBoth ? "gap-6" : "gap-4"}`}>
        {curves.map((c) => {
          const zoneColor = ZONE_COLORS[c.currentZone];
          return (
            <div key={c.sex} className="flex items-start gap-3">
              {isBoth && (
                <span
                  className="font-display text-2xl leading-none mt-5 opacity-70"
                  style={{ color: zoneColor }}
                >
                  {sexSymbol(c.sex)}
                </span>
              )}
              <div>
                <p className="text-xs font-medium tracking-widest uppercase text-on-surface-variant/60">
                  {isBoth ? "BAC" : "Current BAC"}
                </p>
                <div className="flex items-baseline gap-2">
                  <p
                    className={`font-display font-bold tabular-nums leading-none ${isBoth ? "text-3xl" : "text-5xl"}`}
                    style={{ color: zoneColor }}
                  >
                    {formatBAC(c.currentBAC, unit)}
                  </p>
                  <span className="text-sm text-on-surface-variant/40">
                    {unit === "permille" ? "\u2030" : "%"}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: zoneColor }}
                  />
                  <span
                    className="text-[10px] font-medium uppercase tracking-wider"
                    style={{ color: zoneColor }}
                  >
                    {zoneLabel[c.currentZone]}
                  </span>
                </div>
                <div className="mt-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-on-surface-variant/40">
                    Sober in
                  </p>
                  <p className="font-display text-sm font-semibold tabular-nums text-on-surface-variant/60" style={{ minWidth: "4.5ch" }}>
                    {c.currentBAC > 0.001 ? formatSoberTime(c.minutesUntilSober) : "\u2014"}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

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

        {/* Row 2: pace slider, spans the controls column */}
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

        {/* Row 3: clock + speed + play + reset */}
        <div className="flex items-center gap-3">
          <span className="font-display text-sm tabular-nums text-on-surface-variant/60">
            {formatClock(simMinute)}
          </span>

          <div className="flex overflow-hidden rounded-lg border border-outline-variant/20">
            {SPEEDS.map((s) => (
              <button
                key={s.label}
                onClick={() => dispatch({ type: "SET_SPEED", speed: s.value })}
                className={`h-8 cursor-pointer px-2.5 text-xs font-medium transition-colors sm:px-3 ${
                  speedMultiplier === s.value
                    ? "bg-primary/15 text-primary"
                    : "text-on-surface-variant/60 hover:bg-surface-bright/40"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => dispatch({ type: "TOGGLE_PAUSE" })}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-outline-variant/20 text-on-surface-variant transition-colors hover:bg-surface-bright/40"
          >
            {isRunning ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="1" y="1" width="4" height="12" rx="1" />
                <rect x="9" y="1" width="4" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M2.5 1.2a1 1 0 0 1 1.5-.86l9 5.16a1 1 0 0 1 0 1.72l-9 5.16a1 1 0 0 1-1.5-.86V1.2Z" />
              </svg>
            )}
          </button>

          <button
            onClick={() => dispatch({ type: "RESET" })}
            className="flex h-8 cursor-pointer items-center justify-center rounded-lg border border-outline-variant/20 px-3 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-bright/40"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
