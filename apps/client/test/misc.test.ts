import { describe, expect, it } from 'vitest';
import { colorFor, hueFor } from '../src/colors.js';
import { stickVector } from '../src/input.js';
import { computeScale } from '../src/render.js';

describe('stickVector', () => {
  it('returns zero at the centre', () => {
    expect(stickVector(0, 0, 50)).toEqual({ x: 0, y: 0 });
  });

  it('scales linearly inside the radius and clamps outside it', () => {
    const half = stickVector(25, 0, 50);
    expect(half.x).toBeCloseTo(0.5);
    const far = stickVector(300, 400, 50);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1);
    expect(far.x / far.y).toBeCloseTo(0.75);
  });
});

describe('colors', () => {
  it('is deterministic and within the hue range', () => {
    expect(hueFor('abc')).toBe(hueFor('abc'));
    for (const id of ['a', 'b', 'deadbeef', '12345678']) {
      expect(hueFor(id)).toBeGreaterThanOrEqual(0);
      expect(hueFor(id)).toBeLessThan(360);
    }
    expect(colorFor('abc')).toMatch(/^hsl\(\d+ 95% 60%\)$/);
  });

  it('gives different ids different hues (usually)', () => {
    const hues = new Set(['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map(hueFor));
    expect(hues.size).toBeGreaterThan(3);
  });
});

describe('computeScale', () => {
  it('fits the same slice of arena to different viewports', () => {
    expect(computeScale(1200, 750)).toBeCloseTo(1);
    expect(computeScale(2400, 1500)).toBeCloseTo(2);
  });

  it('never goes below the minimum zoom on tiny screens', () => {
    expect(computeScale(100, 100)).toBe(0.35);
  });
});
