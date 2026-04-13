import type { BACDataPoint, SimDrink, BiologicalSex } from "@/app/simulator/lib/types";
import { ZONE_COLORS, getZone } from "@/app/simulator/lib/bac";

export const PADDING_LEFT = 52;
export const PADDING_RIGHT = 16;
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

export interface DragState {
  hoveredId?: string;
  draggingId?: string;
}

export interface ProbeResult {
  minute: number;
  values: { sex: BiologicalSex; bac: number }[];
}

export function renderPlannerGraph(
  ctx: CanvasRenderingContext2D,
  curves: CurveRenderData[],
  windowEnd: number,
  drinks: SimDrink[],
  canvasWidth: number,
  canvasHeight: number,
  unit: BACUnit = "percent",
  dragState?: DragState,
  probeMinute?: number,
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
    PADDING_LEFT + (minute / windowEnd) * plotW;
  const toY = (bac: number) => PADDING_TOP + plotH - (bac / yMax) * plotH;

  ctx.clearRect(0, 0, w, h);

  // Zone bands
  for (const band of ZONE_THRESHOLDS) {
    const clampedMax = Math.min(band.max, yMax);
    if (band.min >= yMax) continue;
    const y1 = toY(clampedMax);
    const y2 = toY(band.min);
    ctx.fillStyle = hexToRgba(ZONE_COLORS[band.zone], band.opacity);
    ctx.fillRect(PADDING_LEFT, y1, plotW, y2 - y1);
  }

  // Y-axis grid + labels
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

  // X-axis grid + labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const timeStep = 30;
  for (let m = 0; m <= windowEnd; m += timeStep) {
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

  // Clip to plot area
  const clipInset = 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(PADDING_LEFT + clipInset, PADDING_TOP, plotW - clipInset, plotH);
  ctx.clip();

  // Draw curves — full extent, no currentMinute clipping
  for (let ci = 0; ci < curves.length; ci++) {
    const { sex, data } = curves[ci];
    const isSecondary = isBothMode && ci > 0;
    const curveAlpha = isSecondary ? 0.5 : 1.0;

    if (data.length > 1) {
      // Fill under curve
      const curvePeak = data.reduce((max, p) => Math.max(max, p.bac), 0);
      const gradient = ctx.createLinearGradient(0, toY(curvePeak), 0, toY(0));
      gradient.addColorStop(0, hexToRgba(ZONE_COLORS[getZone(curvePeak)], 0.12 * curveAlpha));
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

      // Stroke curve
      ctx.lineWidth = isBothMode ? 2 : 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = curveAlpha;
      for (let i = 1; i < data.length; i++) {
        const prev = data[i - 1];
        const curr = data[i];
        ctx.beginPath();
        ctx.moveTo(toX(prev.minute), toY(prev.bac));
        ctx.lineTo(toX(curr.minute), toY(curr.bac));
        ctx.strokeStyle = ZONE_COLORS[curr.zone];
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    }

    // Peak marker for "both" mode
    if (isBothMode && data.length > 0) {
      const peakPt = data.reduce((best, p) => (p.bac > best.bac ? p : best), data[0]);
      if (peakPt.bac > 0.001) {
        const px = toX(peakPt.minute);
        const py = toY(peakPt.bac);
        const zoneColor = ZONE_COLORS[getZone(peakPt.bac)];
        ctx.font = 'bold 18px "Space Grotesk", sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.beginPath();
        ctx.arc(px, py - 16, 12, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(14, 14, 14, 0.7)";
        ctx.fill();
        ctx.fillStyle = zoneColor;
        ctx.globalAlpha = curveAlpha;
        ctx.fillText(SEX_SYMBOL[sex], px, py - 16);
        ctx.globalAlpha = 1.0;
      }
    }
  }

  // Drink markers — show all
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "18px sans-serif";
  for (const drink of drinks) {
    if (drink.loggedAtMinute < 0 || drink.loggedAtMinute > windowEnd) continue;
    const x = toX(drink.loggedAtMinute);
    const allBacs = curves.map((c) => lerpDataPoints(c.data, drink.loggedAtMinute));
    const isDragging = dragState?.draggingId === drink.id;
    const isHovered = dragState?.hoveredId === drink.id;

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

      if (isHovered || isDragging) {
        ctx.beginPath();
        ctx.arc(x, midY, 20, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba("#69f6b8", isDragging ? 0.15 : 0.1);
        ctx.fill();
      }

      ctx.fillStyle = "#e6e1e5";
      ctx.fillText(DRINK_EMOJI[drink.name] ?? "\uD83C\uDF7A", x, midY);
    } else {
      const y = toY(allBacs[0]);
      const emojiY = y - 14;

      if (isHovered || isDragging) {
        ctx.beginPath();
        ctx.arc(x, emojiY, 20, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba("#69f6b8", isDragging ? 0.15 : 0.1);
        ctx.fill();
      }

      ctx.fillStyle = "#e6e1e5";
      ctx.fillText(DRINK_EMOJI[drink.name] ?? "\uD83C\uDF7A", x, emojiY);
    }

    // Vertical guide line while dragging
    if (isDragging) {
      ctx.strokeStyle = hexToRgba("#69f6b8", 0.4);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, PADDING_TOP);
      ctx.lineTo(x, h - PADDING_BOTTOM);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Time label below emoji
    ctx.font = '10px "Space Grotesk", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = hexToRgba("#adaaaa", isHovered || isDragging ? 0.9 : 0.5);
    const labelY = isBothMode
      ? (toY(allBacs[0]) + toY(allBacs[1])) / 2 + 14
      : toY(allBacs[0]) + 2;
    ctx.fillText(formatTime(drink.loggedAtMinute), x, labelY);

    // Reset font for next drink
    ctx.font = "18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  // Peak marker (shown when not probing)
  if (probeMinute == null) {
    for (let ci = 0; ci < curves.length; ci++) {
      const { data } = curves[ci];
      if (data.length === 0) continue;
      const peak = data.reduce((best, p) => (p.bac > best.bac ? p : best), data[0]);
      if (peak.bac <= 0.001) continue;

      const px = toX(peak.minute);
      const py = toY(peak.bac);
      const zoneColor = ZONE_COLORS[getZone(peak.bac)];
      const isSecondary = isBothMode && ci > 0;

      // Glow
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(zoneColor, 0.2);
      ctx.fill();

      // Dot
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = zoneColor;
      ctx.globalAlpha = isSecondary ? 0.6 : 1.0;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Label with backdrop
      const labelText = unit === "permille"
        ? (peak.bac * 10).toFixed(2) + "\u2030"
        : peak.bac.toFixed(3) + "%";
      const fullLabel = isBothMode
        ? SEX_SYMBOL[curves[ci].sex] + " " + labelText
        : labelText;
      ctx.font = 'bold 11px "Space Grotesk", sans-serif';
      const labelMetrics = ctx.measureText(fullLabel);
      const labelPadX = 5;
      const labelPadY = 3;
      const labelH = 14;
      const labelW = labelMetrics.width + labelPadX * 2;
      const labelOffsetX = ci === 0 ? 10 : -(10 + labelW);
      const labelX = px + labelOffsetX;
      const labelY = py - 10 - labelH;

      ctx.fillStyle = "rgba(14, 14, 14, 0.8)";
      ctx.beginPath();
      ctx.roundRect(labelX, labelY, labelW, labelH + labelPadY * 2, 4);
      ctx.fill();

      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = zoneColor;
      ctx.globalAlpha = isSecondary ? 0.7 : 1.0;
      ctx.fillText(fullLabel, labelX + labelPadX, labelY + labelH / 2 + labelPadY);
      ctx.globalAlpha = 1.0;
    }
  }

  // Probe crosshair
  if (probeMinute != null && probeMinute >= 0 && probeMinute <= windowEnd) {
    const px = toX(probeMinute);

    // Vertical line
    ctx.strokeStyle = hexToRgba("#e6e1e5", 0.25);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, PADDING_TOP);
    ctx.lineTo(px, h - PADDING_BOTTOM);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dot on each curve + BAC label
    for (let ci = 0; ci < curves.length; ci++) {
      const { data } = curves[ci];
      const bac = lerpDataPoints(data, probeMinute);
      const py = toY(bac);
      const zoneColor = ZONE_COLORS[getZone(bac)];
      const isSecondary = isBothMode && ci > 0;

      // Glow
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(zoneColor, 0.2);
      ctx.fill();

      // Dot
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = zoneColor;
      ctx.globalAlpha = isSecondary ? 0.6 : 1.0;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // BAC value label with backdrop
      const labelText = unit === "permille"
        ? (bac * 10).toFixed(2) + "\u2030"
        : bac.toFixed(3) + "%";
      const fullLabel = isBothMode
        ? SEX_SYMBOL[curves[ci].sex] + " " + labelText
        : labelText;
      ctx.font = 'bold 11px "Space Grotesk", sans-serif';
      const labelMetrics = ctx.measureText(fullLabel);
      const labelPadX = 5;
      const labelPadY = 3;
      const labelH = 14;
      const labelW = labelMetrics.width + labelPadX * 2;
      const labelOffsetX = ci === 0 ? 10 : -(10 + labelW);
      const labelX = px + labelOffsetX;
      const labelY = py - 10 - labelH;

      // Backdrop
      ctx.fillStyle = "rgba(14, 14, 14, 0.8)";
      ctx.beginPath();
      ctx.roundRect(labelX, labelY, labelW, labelH + labelPadY * 2, 4);
      ctx.fill();

      // Text
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = zoneColor;
      ctx.globalAlpha = isSecondary ? 0.7 : 1.0;
      ctx.fillText(fullLabel, labelX + labelPadX, labelY + labelH / 2 + labelPadY);
      ctx.globalAlpha = 1.0;
    }

    // Time label at bottom
    ctx.font = '10px "Space Grotesk", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = hexToRgba("#e6e1e5", 0.6);
    ctx.fillText(formatTime(probeMinute), px, h - PADDING_BOTTOM + 8);
  }

  // Left fade
  const fadeGrad = ctx.createLinearGradient(PADDING_LEFT, 0, PADDING_LEFT + FADE_WIDTH, 0);
  fadeGrad.addColorStop(0, "rgba(14, 14, 14, 1)");
  fadeGrad.addColorStop(1, "rgba(14, 14, 14, 0)");
  ctx.fillStyle = fadeGrad;
  ctx.fillRect(PADDING_LEFT, PADDING_TOP, FADE_WIDTH, plotH);

  ctx.restore();

  // Baseline
  ctx.strokeStyle = "rgba(51, 51, 51, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING_LEFT, toY(0));
  ctx.lineTo(w - PADDING_RIGHT, toY(0));
  ctx.stroke();

  // Zone labels
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
