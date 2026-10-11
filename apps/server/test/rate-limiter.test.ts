import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../src/rate-limiter.js';

describe('TokenBucket', () => {
  it('allows a burst up to capacity and then rejects', () => {
    const now = 0;
    const bucket = new TokenBucket(3, 1, () => now);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('refills over time but never above capacity', () => {
    let now = 0;
    const bucket = new TokenBucket(2, 10, () => now);
    bucket.take();
    bucket.take();
    expect(bucket.take()).toBe(false);

    now += 100; // +1 token
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);

    now += 10_000; // would be 100 tokens; capped at 2
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
  });
});
