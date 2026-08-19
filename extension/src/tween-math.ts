export const WIN_WIDTH = 160;
export const WIN_HEIGHT = 210;
const MIN_DISTANCE_PX = 20;
const MIN_DURATION_MS = 400;
const MAX_DURATION_MS = 1800;
const SPEED_PX_PER_S = 400;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function computeTweenDurationMs(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): number {
  const d = distance(fromX, fromY, toX, toY);
  if (d < MIN_DISTANCE_PX) return 0;
  return clamp(Math.round((d / SPEED_PX_PER_S) * 1000), MIN_DURATION_MS, MAX_DURATION_MS);
}

export function computePrimaryCenter(workArea: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  return {
    x: Math.round(workArea.x + (workArea.width - WIN_WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - WIN_HEIGHT) / 2),
  };
}

export function walkDirection(fromX: number, toX: number): "left" | "right" {
  return toX >= fromX ? "right" : "left";
}
