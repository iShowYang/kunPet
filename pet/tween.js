const WIN_WIDTH = 160;
const WIN_HEIGHT = 210;
const MIN_DISTANCE_PX = 20;
const MIN_DURATION_MS = 400;
const MAX_DURATION_MS = 1800;
const SPEED_PX_PER_S = 400;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function computeTweenDurationMs(fromX, fromY, toX, toY) {
  const d = distance(fromX, fromY, toX, toY);
  if (d < MIN_DISTANCE_PX) return 0;
  return clamp(Math.round((d / SPEED_PX_PER_S) * 1000), MIN_DURATION_MS, MAX_DURATION_MS);
}

function computePrimaryCenter(workArea) {
  return {
    x: Math.round(workArea.x + (workArea.width - WIN_WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - WIN_HEIGHT) / 2),
  };
}

function walkDirection(fromX, toX) {
  return toX >= fromX ? "right" : "left";
}

module.exports = {
  WIN_WIDTH,
  WIN_HEIGHT,
  lerp,
  computeTweenDurationMs,
  computePrimaryCenter,
  walkDirection,
};
