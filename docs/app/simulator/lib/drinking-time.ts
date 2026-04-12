const DINNER_STYLE_MULT = 1.85;

function baseMins(vol: number): number {
  if (vol <= 40) return 0.5 + (vol / 40) * 0.8;
  if (vol <= 150) return 1.3 + ((vol - 40) / 110) * 2.7;
  return 4.0 + (vol - 150) / 18;
}

function abvFactor(vol: number, abvPct: number): number {
  const shotFactor = 1 + (abvPct - 20) * 0.005;
  const drinkFactor = 1 + (abvPct - 5) * 0.045;
  if (vol <= 40) return shotFactor;
  if (vol >= 150) return drinkFactor;
  const t = (vol - 40) / 110;
  return shotFactor + t * (drinkFactor - shotFactor);
}

function dinnerStyleBlend(vol: number): number {
  if (vol <= 40) return 1.0;
  if (vol >= 150) return DINNER_STYLE_MULT;
  const t = (vol - 40) / 110;
  return 1.0 + t * (DINNER_STYLE_MULT - 1.0);
}

function fatigue(vol: number): number {
  if (vol <= 500) return 1.0;
  return 1.0 + ((vol - 500) / 1000) * 0.4;
}

/**
 * Drinking time in minutes.
 *
 * `pace` ∈ [0, 1]:
 *   0 → no drinking time (shot-it-instantly)
 *   1 → full "dinner-pace" drinking time
 *
 * The scale is linear between the two.
 */
export function drinkingTimeMinutes(
  volumeMl: number,
  abvFraction: number,
  pace: number,
): number {
  const abvPct = abvFraction * 100;
  const dinnerMins =
    baseMins(volumeMl) *
    abvFactor(volumeMl, abvPct) *
    dinnerStyleBlend(volumeMl) *
    fatigue(volumeMl);
  return Math.max(0, dinnerMins * pace);
}

export function drinkingTimeSecs(
  volumeMl: number,
  abvFraction: number,
  pace: number,
): number {
  return drinkingTimeMinutes(volumeMl, abvFraction, pace) * 60;
}
