import type { BACDataPoint, SimDrink, BiologicalSex } from "./types";
import { ZONE_COLORS, getZone } from "./bac";

const PADDING_LEFT = 52;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 36;
const FADE_WIDTH = 48;

const DRINK_EMOJI: Record<string, string> = {
  Beer: "\uD83C\uDF7A",
  Wine: "\uD83C\uDF77",
  Shot: "\uD83E\uDD43",
  Cocktail: "\uD83C\uDF78",
};

const ZONE_THRESHOLDS = [
  { min: 0, max: 0.06, zone: "belowSweetSpot" as const, opacity: 0.04 },
  { min: 0.06, max: 0.09, zone: "sweetSpot" as const, opacity: 0.1 },
  { min: 0.09, max: 0.1, zone: "caution" as const, opacity: 0.08 },
  { min: 0.1, max: 0.2, zone: "danger" as const, opacity: 0.06 },
];

const SEX_SYMBOL: Record<BiologicalSex, string> = {
  male: "\u2642",
  female: "\u2640",
};

function formatTime(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

type BACUnit = "percent" | "permille";

function formatYLabel(bac: number, unit: BACUnit): string {
  if (unit === "permille") return (bac * 10).toFixed(1);
  return bac.toFixed(2);
}

export interface CurveRenderData {
  sex: BiologicalSex;
  data: BACDataPoint[];
}

export function renderGraph(
  ctx: CanvasRenderingContext2D,
  curves: CurveRenderData[],
  currentMinute: number,
  windowStart: number,
  windowEnd: number,
  drinks: SimDrink[],
  canvasWidth: number,
  canvasHeight: number,
  unit: BACUnit = "percent",
): void {
  const w = canvasWidth;
  const h = canvasHeight;
  const plotW = w - PADDING_LEFT - PADDING_RIGHT;
  const plotH = h - PADDING_TOP - PADDING_BOTTOM;
  const isBothMode = curves.length > 1;

  let peakBAC = 0;
  for (const curve of curves) {
    for (const p of curve.data) {
      if (p.bac > peakBAC) peakBAC = p.bac;
    }
  }
  const yMax = Math.max(0.12, peakBAC * 1.3);

  const toX = (minute: number) =>
    PADDING_LEFT +
    ((minute - windowStart) / (windowEnd - windowStart)) * plotW;
  const toY = (bac: number) => PADDING_TOP + plotH - (bac / yMax) * plotH;

  ctx.clearRect(0, 0, w, h);

  for (const band of ZONE_THRESHOLDS) {
    const clampedMax = Math.min(band.max, yMax);
    if (band.min >= yMax) continue;
    const y1 = toY(clampedMax);
    const y2 = toY(band.min);
    ctx.fillStyle = hexToRgba(ZONE_COLORS[band.zone], band.opacity);
    ctx.fillRect(PADDING_LEFT, y1, plotW, y2 - y1);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = '11px "Space Grotesk", sans-serif';
  const bacStep = yMax <= 0.15 ? 0.02 : 0.05;
  for (let bac = bacStep; bac < yMax; bac += bacStep) {
    const y = toY(bac);
    ctx.strokeStyle = "rgba(51, 51, 51, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING_LEFT, y);
    ctx.lineTo(w - PADDING_RIGHT, y);
    ctx.stroke();
    ctx.fillStyle = "#adaaaa";
    ctx.fillText(formatYLabel(bac, unit), PADDING_LEFT - 8, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const timeStep = 30;
  const firstTick = Math.ceil(windowStart / timeStep) * timeStep;
  for (let m = firstTick; m <= windowEnd; m += timeStep) {
    const x = toX(m);
    ctx.strokeStyle = "rgba(51, 51, 51, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, PADDING_TOP);
    ctx.lineTo(x, h - PADDING_BOTTOM);
    ctx.stroke();
    ctx.fillStyle = "#adaaaa";
    ctx.fillText(formatTime(m), x, h - PADDING_BOTTOM + 8);
  }

  const clipInset = 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(PADDING_LEFT + clipInset, PADDING_TOP, plotW - clipInset, plotH);
  ctx.clip();

  for (let ci = 0; ci < curves.length; ci++) {
    const { sex, data } = curves[ci];
    const isSecondary = isBothMode && ci > 0;
    const curveAlpha = isSecondary ? 0.5 : 1.0;

    if (data.length > 1) {
      const curvePeak = data.reduce((max, p) => Math.max(max, p.bac), 0);
      const gradient = ctx.createLinearGradient(0, toY(curvePeak), 0, toY(0));
      gradient.addColorStop(
        0,
        hexToRgba(ZONE_COLORS[getZone(curvePeak)], 0.12 * curveAlpha),
      );
      gradient.addColorStop(1, "transparent");

      ctx.beginPath();
      ctx.moveTo(toX(data[0].minute), toY(0));
      for (const point of data) {
        ctx.lineTo(toX(point.minute), toY(point.bac));
      }
      ctx.lineTo(toX(data[data.length - 1].minute), toY(0));
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.lineWidth = isBothMode ? 2 : 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = curveAlpha;
      for (let i = 1; i < data.length; i++) {
        const prev = data[i - 1];
        const curr = data[i];
        if (prev.minute > currentMinute) break;
        const clampedMinute = Math.min(curr.minute, currentMinute);
        ctx.beginPath();
        ctx.moveTo(toX(prev.minute), toY(prev.bac));
        ctx.lineTo(toX(clampedMinute), toY(curr.bac));
        ctx.strokeStyle = ZONE_COLORS[curr.zone];
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    }

    if (currentMinute >= windowStart && currentMinute <= windowEnd) {
      const cx = toX(currentMinute);
      const interpolatedBAC = lerpDataPoints(data, currentMinute);

      if (interpolatedBAC > 0.001) {
        const cy = toY(interpolatedBAC);
        const zoneColor = ZONE_COLORS[getZone(interpolatedBAC)];

        if (isBothMode) {
          const aheadBAC = lerpDataPoints(data, currentMinute + 3);
          const aheadX = toX(currentMinute + 3);
          const aheadY = toY(aheadBAC);
          ctx.font = 'bold 22px "Space Grotesk", sans-serif';
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.beginPath();
          ctx.arc(aheadX, aheadY, 14, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(14, 14, 14, 0.7)";
          ctx.fill();
          ctx.fillStyle = zoneColor;
          ctx.fillText(SEX_SYMBOL[sex], aheadX, aheadY);
        } else {
          ctx.beginPath();
          ctx.arc(cx, cy, 8, 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(zoneColor, 0.2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, cy, 4, 0, Math.PI * 2);
          ctx.fillStyle = zoneColor;
          ctx.fill();
        }
      }
    }
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "18px sans-serif";
  for (const drink of drinks) {
    if (
      drink.loggedAtMinute < windowStart ||
      drink.loggedAtMinute > windowEnd ||
      drink.loggedAtMinute > currentMinute
    )
      continue;
    const x = toX(drink.loggedAtMinute);
    const allBacs = curves.map((c) =>
      lerpDataPoints(c.data, drink.loggedAtMinute),
    );

    if (isBothMode && allBacs.length === 2) {
      const y1 = toY(allBacs[0]);
      const y2 = toY(allBacs[1]);
      const topBAC = Math.max(allBacs[0], allBacs[1]);
      const botBAC = Math.min(allBacs[0], allBacs[1]);
      const lineGrad = ctx.createLinearGradient(0, Math.min(y1, y2), 0, Math.max(y1, y2));
      lineGrad.addColorStop(0, hexToRgba(ZONE_COLORS[getZone(topBAC)], 0.6));
      lineGrad.addColorStop(1, hexToRgba(ZONE_COLORS[getZone(botBAC)], 0.6));
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      const midY = (y1 + y2) / 2;
      ctx.fillText(DRINK_EMOJI[drink.name] ?? "\uD83C\uDF7A", x, midY);
    } else {
      const y = toY(allBacs[0]);
      ctx.fillText(DRINK_EMOJI[drink.name] ?? "\uD83C\uDF7A", x, y - 14);
    }
  }

  if (currentMinute >= windowStart && currentMinute <= windowEnd) {
    const cx = toX(currentMinute);
    ctx.strokeStyle = hexToRgba("#69f6b8", 0.3);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, PADDING_TOP);
    ctx.lineTo(cx, h - PADDING_BOTTOM);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const fadeGrad = ctx.createLinearGradient(
    PADDING_LEFT,
    0,
    PADDING_LEFT + FADE_WIDTH,
    0,
  );
  fadeGrad.addColorStop(0, "rgba(14, 14, 14, 1)");
  fadeGrad.addColorStop(1, "rgba(14, 14, 14, 0)");
  ctx.fillStyle = fadeGrad;
  ctx.fillRect(PADDING_LEFT, PADDING_TOP, FADE_WIDTH, plotH);

  ctx.restore();

  ctx.strokeStyle = "rgba(51, 51, 51, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING_LEFT, toY(0));
  ctx.lineTo(w - PADDING_RIGHT, toY(0));
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = '10px "Space Grotesk", sans-serif';
  if (0.06 < yMax) {
    ctx.fillStyle = hexToRgba(ZONE_COLORS.sweetSpot, 0.5);
    ctx.fillText("sweet spot", PADDING_LEFT + FADE_WIDTH + 4, toY(0.06) - 8);
  }
  if (0.09 < yMax) {
    ctx.fillStyle = hexToRgba(ZONE_COLORS.caution, 0.5);
    ctx.fillText("caution", PADDING_LEFT + FADE_WIDTH + 4, toY(0.09) - 8);
  }
  if (0.1 < yMax) {
    ctx.fillStyle = hexToRgba(ZONE_COLORS.danger, 0.5);
    ctx.fillText("danger", PADDING_LEFT + FADE_WIDTH + 4, toY(0.1) - 8);
  }
}

function lerpDataPoints(data: BACDataPoint[], minute: number): number {
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

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
