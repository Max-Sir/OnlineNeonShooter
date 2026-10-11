/** Token bucket: allows bursts up to `capacity`, refilling at `ratePerSecond`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly ratePerSecond: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  /** Try to consume one token. Returns false when the caller is over the limit. */
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((t - this.last) / 1000) * this.ratePerSecond,
    );
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
