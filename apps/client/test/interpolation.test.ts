import type { SnapPlayer, SnapshotMsg } from '@neon/shared';
import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from '../src/interpolation.js';

const TICK_RATE = 30;
const msPerTick = 1000 / TICK_RATE;

function player(id: string, x: number, extra: Partial<SnapPlayer> = {}): SnapPlayer {
  return { id, x, y: 100, angle: 0, hp: 100, alive: true, kills: 0, deaths: 0, seq: 0, ...extra };
}

function snap(
  tick: number,
  players: SnapPlayer[],
  bullets: SnapshotMsg['bullets'] = [],
): SnapshotMsg {
  return { t: 'snap', tick, players, bullets };
}

describe('SnapshotBuffer', () => {
  it('returns null before any snapshot', () => {
    expect(new SnapshotBuffer(TICK_RATE).sample(1000)).toBeNull();
  });

  it('interpolates positions between two snapshots, rendering 100ms in the past', () => {
    const buf = new SnapshotBuffer(TICK_RATE, 100);
    // Snapshots 2 ticks apart, arriving on time (arrival = server time + 50ms constant latency).
    buf.push(snap(0, [player('a', 0)]), 50);
    buf.push(snap(2, [player('a', 100)]), 2 * msPerTick + 50);

    // Server time 100 + 33.3/2 ms -> renderTime ~ midpoint between the snapshots.
    const mid = msPerTick + 50 + 100;
    const s = buf.sample(mid);
    expect(s?.players[0]?.x).toBeCloseTo(50, 0);
  });

  it('holds the newest snapshot instead of extrapolating when data is late', () => {
    const buf = new SnapshotBuffer(TICK_RATE, 100);
    buf.push(snap(0, [player('a', 0)]), 0);
    buf.push(snap(2, [player('a', 100)]), 2 * msPerTick);
    const s = buf.sample(5000);
    expect(s?.players[0]?.x).toBe(100);
  });

  it('shows the oldest snapshot when render time is before the buffer', () => {
    const buf = new SnapshotBuffer(TICK_RATE, 100);
    buf.push(snap(10, [player('a', 42)]), 1000);
    expect(buf.sample(1000)?.players[0]?.x).toBe(42);
  });

  it('ignores duplicate and out-of-order snapshots', () => {
    const buf = new SnapshotBuffer(TICK_RATE);
    buf.push(snap(5, [player('a', 1)]), 0);
    buf.push(snap(5, [player('a', 2)]), 1);
    buf.push(snap(4, [player('a', 3)]), 2);
    expect(buf.length).toBe(1);
  });

  it('does not slide players across the map when they respawn', () => {
    const buf = new SnapshotBuffer(TICK_RATE, 0);
    buf.push(snap(0, [player('a', 0, { alive: false })]), 0);
    buf.push(snap(2, [player('a', 1500, { alive: true })]), 2 * msPerTick);
    const s = buf.sample(msPerTick);
    expect(s?.players[0]?.x).toBe(1500);
  });

  it('marks players that appear mid-interval as fresh', () => {
    const buf = new SnapshotBuffer(TICK_RATE, 0);
    buf.push(snap(0, [player('a', 0)]), 0);
    buf.push(snap(2, [player('a', 10), player('b', 500)]), 2 * msPerTick);
    const s = buf.sample(msPerTick);
    expect(s?.players.find((p) => p.id === 'b')?.fresh).toBe(true);
    expect(s?.players.find((p) => p.id === 'a')?.fresh).toBe(false);
  });

  it('interpolates angles along the shortest arc', () => {
    const buf = new SnapshotBuffer(TICK_RATE, 0);
    buf.push(snap(0, [player('a', 0, { angle: 3.0 })]), 0);
    buf.push(snap(2, [player('a', 0, { angle: -3.0 })]), 2 * msPerTick);
    const angle = buf.sample(msPerTick)?.players[0]?.angle ?? 0;
    // Halfway along the short way around is ~±π, not 0.
    expect(Math.abs(Math.abs(angle) - Math.PI)).toBeLessThan(0.2);
  });

  it('moves bullets along their velocity between snapshots', () => {
    const buf = new SnapshotBuffer(TICK_RATE, 0);
    const bullet = { id: 1, owner: 'a', x: 0, y: 0, vx: 600, vy: 0 };
    buf.push(snap(0, [player('a', 0)], [bullet]), 0);
    buf.push(snap(2, [player('a', 0)], [{ ...bullet, x: 40 }]), 2 * msPerTick);
    const b = buf.sample(msPerTick)?.bullets[0];
    expect(b?.x).toBeCloseTo(600 * (msPerTick / 1000), 1);
  });
});
