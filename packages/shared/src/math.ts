import type { Rect, Vec2 } from './types.js';

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Deterministic PRNG. Mutates and returns the next state together with a float in [0, 1). */
export function mulberry32(state: number): { state: number; value: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** Push a circle (mutating `c`) out of a rectangle if they overlap. */
export function resolveCircleRect(c: Vec2, r: number, rect: Rect): void {
  const nx = clamp(c.x, rect.x, rect.x + rect.w);
  const ny = clamp(c.y, rect.y, rect.y + rect.h);
  const dx = c.x - nx;
  const dy = c.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;

  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const push = r - d;
    c.x += (dx / d) * push;
    c.y += (dy / d) * push;
    return;
  }

  // Circle centre is inside the rectangle: leave through the nearest edge.
  const left = c.x - rect.x;
  const right = rect.x + rect.w - c.x;
  const top = c.y - rect.y;
  const bottom = rect.y + rect.h - c.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) c.x = rect.x - r;
  else if (m === right) c.x = rect.x + rect.w + r;
  else if (m === top) c.y = rect.y - r;
  else c.y = rect.y + rect.h + r;
}

export function circleIntersectsRect(c: Vec2, r: number, rect: Rect): boolean {
  const nx = clamp(c.x, rect.x, rect.x + rect.w);
  const ny = clamp(c.y, rect.y, rect.y + rect.h);
  const dx = c.x - nx;
  const dy = c.y - ny;
  return dx * dx + dy * dy < r * r;
}

/**
 * Swept test of the segment (x0,y0)->(x1,y1) against a rectangle.
 * Returns the entry parameter t in [0, 1], or null when there is no hit.
 */
export function segmentRectT(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rect: Rect,
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tmin = 0;
  let tmax = 1;

  if (Math.abs(dx) < 1e-12) {
    if (x0 < rect.x || x0 > rect.x + rect.w) return null;
  } else {
    let t1 = (rect.x - x0) / dx;
    let t2 = (rect.x + rect.w - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (Math.abs(dy) < 1e-12) {
    if (y0 < rect.y || y0 > rect.y + rect.h) return null;
  } else {
    let t1 = (rect.y - y0) / dy;
    let t2 = (rect.y + rect.h - y0) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  return tmin;
}

/**
 * Swept test of the segment (x0,y0)->(x1,y1) against a circle.
 * Returns the entry parameter t in [0, 1], or null when there is no hit.
 */
export function segmentCircleT(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  r: number,
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // start point already inside the circle
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
