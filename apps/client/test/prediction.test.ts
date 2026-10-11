import {
  DEFAULT_TICK_RATE,
  addPlayer,
  applyInput,
  createWorld,
  type InputCmd,
  type SnapPlayer,
} from '@neon/shared';
import { describe, expect, it } from 'vitest';
import { Predictor } from '../src/prediction.js';

const DT = 1 / DEFAULT_TICK_RATE;

function cmd(seq: number, mx = 1, my = 0): InputCmd {
  return { seq, mx, my, angle: 0, shoot: false };
}

function serverView(x: number, y: number, seq: number, alive = true): SnapPlayer {
  return { id: 'me', x, y, angle: 0, hp: 100, alive, kills: 0, deaths: 0, seq };
}

describe('Predictor', () => {
  it('is not ready until the first server state arrives', () => {
    const p = new Predictor(DT);
    expect(p.ready).toBe(false);
    p.apply(cmd(1));
    expect(p.pos).toEqual({ x: 0, y: 0 });
    p.reconcile(serverView(500, 600, 0));
    expect(p.ready).toBe(true);
    // The input applied before readiness is replayed on top of the server state.
    expect(p.pos.x).toBeGreaterThan(500);
  });

  it('matches the server exactly when it agrees (no visible correction)', () => {
    const world = createWorld(5);
    const me = addPlayer(world, 'me');
    const predictor = new Predictor(DT);
    predictor.reconcile(serverView(me.x, me.y, 0));

    const inputs = Array.from({ length: 30 }, (_, i) =>
      cmd(i + 1, Math.cos(i / 4), Math.sin(i / 3)),
    );
    for (const c of inputs) predictor.apply(c);

    // The server has processed only the first 20 inputs when its snapshot is taken.
    for (const c of inputs.slice(0, 20)) applyInput(world, 'me', c, DT);
    predictor.reconcile(serverView(me.x, me.y, 20));

    // Server then catches up on the remaining 10.
    for (const c of inputs.slice(20)) applyInput(world, 'me', c, DT);

    expect(predictor.pos.x).toBeCloseTo(me.x, 6);
    expect(predictor.pos.y).toBeCloseTo(me.y, 6);
    expect(predictor.lastError).toBeLessThan(1e-6);
    expect(predictor.pendingCount).toBe(10);
  });

  it('corrects towards the server when they disagree', () => {
    const predictor = new Predictor(DT);
    predictor.reconcile(serverView(500, 600, 0));
    for (let i = 1; i <= 5; i++) predictor.apply(cmd(i));
    // Server says we were pushed back (e.g. by a wall we did not know about).
    predictor.reconcile(serverView(480, 600, 5));
    expect(predictor.pos).toEqual({ x: 480, y: 600 });
    expect(predictor.lastError).toBeGreaterThan(1);
    expect(predictor.pendingCount).toBe(0);
  });

  it('drops pending inputs when dead and snaps to the server position', () => {
    const predictor = new Predictor(DT);
    predictor.reconcile(serverView(500, 600, 0));
    predictor.apply(cmd(1));
    predictor.reconcile(serverView(700, 700, 1, false));
    expect(predictor.pos).toEqual({ x: 700, y: 700 });
    expect(predictor.pendingCount).toBe(0);
  });

  it('bounds the pending-input buffer if acknowledgements stop', () => {
    const predictor = new Predictor(DT);
    predictor.reconcile(serverView(500, 600, 0));
    for (let i = 1; i <= 500; i++) predictor.apply(cmd(i, 0, 0));
    expect(predictor.pendingCount).toBeLessThanOrEqual(120);
  });
});
