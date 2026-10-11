import { describe, expect, it } from 'vitest';
import {
  circleIntersectsRect,
  clamp,
  mulberry32,
  resolveCircleRect,
  segmentCircleT,
  segmentRectT,
} from '../src/math.js';

describe('clamp', () => {
  it('limits values to the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('mulberry32', () => {
  it('is deterministic and returns values in [0, 1)', () => {
    let a = 42;
    let b = 42;
    for (let i = 0; i < 100; i++) {
      const ra = mulberry32(a);
      const rb = mulberry32(b);
      a = ra.state;
      b = rb.state;
      expect(ra.value).toBe(rb.value);
      expect(ra.value).toBeGreaterThanOrEqual(0);
      expect(ra.value).toBeLessThan(1);
    }
  });
});

describe('resolveCircleRect', () => {
  const rect = { x: 100, y: 100, w: 100, h: 100 };

  it('pushes a circle out along the contact normal', () => {
    const c = { x: 95, y: 150 }; // 5px left of the rect, radius 16 -> overlaps by 11
    resolveCircleRect(c, 16, rect);
    expect(c.x).toBeCloseTo(84);
    expect(c.y).toBeCloseTo(150);
  });

  it('does nothing when there is no overlap', () => {
    const c = { x: 50, y: 150 };
    resolveCircleRect(c, 16, rect);
    expect(c).toEqual({ x: 50, y: 150 });
    expect(circleIntersectsRect(c, 16, rect)).toBe(false);
  });

  it('ejects a circle whose centre is inside the rectangle', () => {
    const c = { x: 110, y: 150 }; // nearest edge is the left one
    resolveCircleRect(c, 16, rect);
    expect(c.x).toBeCloseTo(84);
    expect(circleIntersectsRect(c, 16, rect)).toBe(false);
  });
});

describe('segmentRectT', () => {
  const rect = { x: 100, y: 100, w: 100, h: 100 };

  it('returns the entry parameter for a crossing segment', () => {
    expect(segmentRectT(0, 150, 200, 150, rect)).toBeCloseTo(0.5);
  });

  it('returns null when the segment misses or stops short', () => {
    expect(segmentRectT(0, 50, 200, 50, rect)).toBeNull();
    expect(segmentRectT(0, 150, 90, 150, rect)).toBeNull();
    expect(segmentRectT(150, 0, 150, 90, rect)).toBeNull();
  });

  it('returns 0 when the segment starts inside', () => {
    expect(segmentRectT(150, 150, 400, 150, rect)).toBe(0);
  });
});

describe('segmentCircleT', () => {
  it('detects a head-on hit', () => {
    const t = segmentCircleT(0, 0, 100, 0, 50, 0, 10);
    expect(t).toBeCloseTo(0.4);
  });

  it('detects a fast segment that would tunnel through a point test', () => {
    // Segment length 200 vs circle diameter 20: still must hit.
    expect(segmentCircleT(0, 0, 200, 0, 100, 5, 10)).not.toBeNull();
  });

  it('misses when passing outside the radius', () => {
    expect(segmentCircleT(0, 0, 100, 0, 50, 30, 10)).toBeNull();
  });

  it('returns 0 when starting inside the circle', () => {
    expect(segmentCircleT(50, 0, 100, 0, 50, 0, 10)).toBe(0);
  });
});
