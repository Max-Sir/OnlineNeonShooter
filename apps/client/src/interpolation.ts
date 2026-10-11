import type { SnapBullet, SnapPlayer, SnapshotMsg } from '@neon/shared';

export interface InterpPlayer extends SnapPlayer {
  /** True when this player was only present in the newer snapshot (just spawned/joined). */
  fresh: boolean;
}

export interface Sample {
  players: InterpPlayer[];
  bullets: SnapBullet[];
}

interface Stored {
  /** Server time in ms, derived from the tick number. */
  time: number;
  snap: SnapshotMsg;
}

const MAX_SNAPSHOTS = 40;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Buffers server snapshots and renders the world slightly in the past so that
 * motion stays smooth despite network jitter (entity interpolation).
 */
export class SnapshotBuffer {
  private readonly buf: Stored[] = [];
  private offset: number | null = null;

  constructor(
    private readonly tickRate: number,
    /** How far behind the estimated server time we render, in ms. */
    readonly delayMs = 100,
  ) {}

  get length(): number {
    return this.buf.length;
  }

  push(snap: SnapshotMsg, arrivalMs: number): void {
    const time = (snap.tick * 1000) / this.tickRate;

    // Track (arrival - serverTime). Jitter only ever makes packets later, so follow the minimum
    // quickly and drift upwards slowly to adapt to genuine clock/latency changes.
    const sample = arrivalMs - time;
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.01;

    const last = this.buf.at(-1);
    if (last && time <= last.time) return; // duplicate or out of order
    this.buf.push({ time, snap });
    if (this.buf.length > MAX_SNAPSHOTS) this.buf.shift();
  }

  /** Estimated current server time in ms for a given local clock reading. */
  serverTime(nowMs: number): number | null {
    return this.offset === null ? null : nowMs - this.offset;
  }

  /** Interpolated world at the given local clock time, or null before the first snapshot. */
  sample(nowMs: number): Sample | null {
    const st = this.serverTime(nowMs);
    if (st === null || this.buf.length === 0) return null;
    const renderTime = st - this.delayMs;

    const first = this.buf[0];
    const newest = this.buf[this.buf.length - 1];
    if (!first || !newest) return null;

    // Before the oldest snapshot: show the oldest. After the newest: hold the newest (no extrapolation).
    if (renderTime <= first.time) return toSample(first.snap);
    if (renderTime >= newest.time) return toSample(newest.snap);

    let i = this.buf.length - 2;
    while (i > 0 && (this.buf[i]?.time ?? 0) > renderTime) i--;
    const a = this.buf[i];
    const b = this.buf[i + 1];
    if (!a || !b) return toSample(newest.snap);

    const t = (renderTime - a.time) / (b.time - a.time);
    const prev = new Map(a.snap.players.map((p) => [p.id, p]));

    const players: InterpPlayer[] = b.snap.players.map((pb) => {
      const pa = prev.get(pb.id);
      if (!pa) return { ...pb, fresh: true };
      // A respawn teleports the player: don't slide across the map.
      const teleported = (!pa.alive && pb.alive) || Math.hypot(pb.x - pa.x, pb.y - pa.y) > 300;
      if (teleported) return { ...pb, fresh: false };
      return {
        ...pb,
        x: lerp(pa.x, pb.x, t),
        y: lerp(pa.y, pb.y, t),
        angle: lerpAngle(pa.angle, pb.angle, t),
        fresh: false,
      };
    });

    // Bullets fly in straight lines: extrapolate from the older snapshot by their velocity.
    const dtSec = (renderTime - a.time) / 1000;
    const bIds = new Set(b.snap.bullets.map((x) => x.id));
    const bullets: SnapBullet[] = a.snap.bullets
      .filter((x) => bIds.has(x.id))
      .map((x) => ({ ...x, x: x.x + x.vx * dtSec, y: x.y + x.vy * dtSec }));
    // Bullets that spawned between a and b are shown from b's position.
    const aIds = new Set(a.snap.bullets.map((x) => x.id));
    for (const x of b.snap.bullets) if (!aIds.has(x.id)) bullets.push(x);

    return { players, bullets };
  }
}

function toSample(snap: SnapshotMsg): Sample {
  return { players: snap.players.map((p) => ({ ...p, fresh: false })), bullets: snap.bullets };
}
