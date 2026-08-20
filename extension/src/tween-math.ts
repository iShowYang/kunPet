export const WIN_WIDTH = 160;
export const WIN_HEIGHT = 210;
const MIN_DISTANCE_PX = 20;
const MIN_DURATION_MS = 400;
const MAX_DURATION_MS = 1800;
const SPEED_PX_PER_S = 400;

export const WALK_STYLE_IDS = ["straight", "arc", "hop", "dash"] as const;
export type WalkStyleId = (typeof WALK_STYLE_IDS)[number];

export type WalkPose = {
  x: number;
  y: number;
  scale: number;
  rotate: number;
};

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

export function pickWalkStyleId(random = Math.random): WalkStyleId {
  const i = Math.floor(random() * WALK_STYLE_IDS.length) % WALK_STYLE_IDS.length;
  return WALK_STYLE_IDS[i];
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Fast early, slow late (dash). */
function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function sampleStraight(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number
): WalkPose {
  const u = easeOutCubic(clamp(t, 0, 1));
  return {
    x: lerp(from.x, to.x, u),
    y: lerp(from.y, to.y, u),
    scale: 1,
    rotate: 0,
  };
}

function sampleArc(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number
): WalkPose {
  const u = clamp(t, 0, 1);
  const eased = easeOutCubic(u);
  const x = lerp(from.x, to.x, eased);
  const yBase = lerp(from.y, to.y, eased);
  const d = distance(from.x, from.y, to.x, to.y);
  const lift = Math.min(80, Math.max(24, d * 0.12));
  // Parabolic lift peaking at mid, zero at ends
  const y = yBase - lift * 4 * u * (1 - u);
  return { x, y, scale: 1, rotate: 0 };
}

function sampleHop(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number
): WalkPose {
  const u = clamp(t, 0, 1);
  const eased = easeOutCubic(u);
  const x = lerp(from.x, to.x, eased);
  const yBase = lerp(from.y, to.y, eased);
  const hops = 3;
  const hopAmp = 28;
  const hop = Math.abs(Math.sin(u * Math.PI * hops)) * hopAmp * (1 - u * 0.35);
  return { x, y: yBase - hop, scale: 1, rotate: 0 };
}

function sampleDash(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number
): WalkPose {
  const u = clamp(t, 0, 1);
  const eased = easeOutQuad(u);
  const x = lerp(from.x, to.x, eased);
  const y = lerp(from.y, to.y, eased);
  // Last 15%: scale 1 -> 1.08 -> 1
  let scale = 1;
  if (u >= 0.85) {
    const local = (u - 0.85) / 0.15;
    scale = local < 0.5 ? lerp(1, 1.08, local * 2) : lerp(1.08, 1, (local - 0.5) * 2);
  }
  return { x, y, scale, rotate: 0 };
}

export function sampleWalkPose(
  styleId: WalkStyleId,
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number
): WalkPose {
  switch (styleId) {
    case "arc":
      return sampleArc(from, to, t);
    case "hop":
      return sampleHop(from, to, t);
    case "dash":
      return sampleDash(from, to, t);
    case "straight":
    default:
      return sampleStraight(from, to, t);
  }
}
