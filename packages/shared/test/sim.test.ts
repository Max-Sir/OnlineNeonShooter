import { describe, expect, it } from 'vitest';
import {
  BULLET_DAMAGE,
  DEFAULT_TICK_RATE,
  FIRE_COOLDOWN,
  MAP_HEIGHT,
  MAP_WIDTH,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  RESPAWN_TIME,
  SPAWN_POINTS,
  WALLS,
} from '../src/constants.js';
import { circleIntersectsRect } from '../src/math.js';
import {
  addPlayer,
  applyInput,
  createWorld,
  movePlayer,
  removePlayer,
  stepWorld,
} from '../src/sim.js';
import type { InputCmd, PlayerState, World } from '../src/types.js';

const DT = 1 / DEFAULT_TICK_RATE;

function input(partial: Partial<InputCmd> = {}): InputCmd {
  return { seq: 1, mx: 0, my: 0, angle: 0, shoot: false, ...partial };
}

/** Two players standing in the open, `a` at (500, 600) aiming right at `b` at (700, 600). */
function duel(): { world: World; a: PlayerState; b: PlayerState } {
  const world = createWorld(7);
  const a = addPlayer(world, 'a');
  const b = addPlayer(world, 'b');
  a.x = 500;
  a.y = 600;
  b.x = 700;
  b.y = 600;
  return { world, a, b };
}

function runTicks(world: World, n: number): void {
  for (let i = 0; i < n; i++) stepWorld(world, DT);
}

describe('map data', () => {
  it('has spawn points that are inside the map and clear of walls', () => {
    for (const sp of SPAWN_POINTS) {
      expect(sp.x).toBeGreaterThan(PLAYER_RADIUS);
      expect(sp.x).toBeLessThan(MAP_WIDTH - PLAYER_RADIUS);
      expect(sp.y).toBeGreaterThan(PLAYER_RADIUS);
      expect(sp.y).toBeLessThan(MAP_HEIGHT - PLAYER_RADIUS);
      for (const wall of WALLS) {
        expect(circleIntersectsRect(sp, PLAYER_RADIUS, wall)).toBe(false);
      }
    }
  });
});

describe('movement', () => {
  it('moves at PLAYER_SPEED along one axis', () => {
    const p = { x: 500, y: 600 };
    movePlayer(p, { mx: 1, my: 0 }, 1);
    expect(p.x).toBeCloseTo(500 + PLAYER_SPEED);
  });

  it('does not move faster diagonally', () => {
    const p = { x: 500, y: 600 };
    movePlayer(p, { mx: 1, my: 1 }, 1);
    expect(Math.hypot(p.x - 500, p.y - 600)).toBeCloseTo(PLAYER_SPEED);
  });

  it('clamps out-of-range and non-finite axes (cheat resistance)', () => {
    const p = { x: 500, y: 600 };
    movePlayer(p, { mx: 1000, my: Number.NaN }, 1);
    expect(p.x).toBeCloseTo(500 + PLAYER_SPEED);
    expect(p.y).toBe(600);
  });

  it('keeps players inside the map', () => {
    const p = { x: PLAYER_RADIUS + 1, y: 600 };
    movePlayer(p, { mx: -1, my: 0 }, 5);
    expect(p.x).toBe(PLAYER_RADIUS);
  });

  it('blocks players at walls', () => {
    const wall = WALLS[0];
    if (!wall) throw new Error('no walls defined');
    const p = { x: wall.x - PLAYER_RADIUS - 2, y: wall.y + wall.h / 2 };
    for (let i = 0; i < 30; i++) movePlayer(p, { mx: 1, my: 0 }, DT);
    expect(circleIntersectsRect(p, PLAYER_RADIUS - 0.01, wall)).toBe(false);
    expect(p.x).toBeLessThanOrEqual(wall.x - PLAYER_RADIUS + 0.001);
  });
});

describe('players', () => {
  it('spawns new players away from existing ones', () => {
    const world = createWorld(3);
    const first = addPlayer(world, 'one');
    const second = addPlayer(world, 'two');
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(500);
  });

  it('removes a player together with their bullets', () => {
    const { world } = duel();
    applyInput(world, 'a', input({ shoot: true }), DT);
    expect(world.bullets).toHaveLength(1);
    removePlayer(world, 'a');
    expect(world.players.has('a')).toBe(false);
    expect(world.bullets).toHaveLength(0);
  });

  it('records the last applied input sequence', () => {
    const { world, a } = duel();
    applyInput(world, 'a', input({ seq: 42 }), DT);
    expect(a.seq).toBe(42);
  });
});

describe('shooting', () => {
  it('respects the fire cooldown', () => {
    const { world } = duel();
    applyInput(world, 'a', input({ shoot: true }), DT);
    applyInput(world, 'a', input({ shoot: true }), DT);
    expect(world.bullets).toHaveLength(1);

    runTicks(world, Math.ceil(FIRE_COOLDOWN / DT) + 1);
    applyInput(world, 'a', input({ shoot: true }), DT);
    expect(world.bullets.length).toBeGreaterThanOrEqual(1);
    expect(world.players.get('a')?.cooldown).toBeGreaterThan(0);
  });

  it('damages the target and awards a kill after enough hits', () => {
    const { world, a, b } = duel();
    const shots = Math.ceil(PLAYER_MAX_HP / BULLET_DAMAGE);
    const events = [];
    for (let s = 0; s < shots; s++) {
      applyInput(world, 'a', input({ shoot: true }), DT);
      for (let i = 0; i < 20; i++) events.push(...stepWorld(world, DT));
    }
    expect(b.alive).toBe(false);
    expect(b.hp).toBe(0);
    expect(b.deaths).toBe(1);
    expect(a.kills).toBe(1);
    expect(events).toEqual([{ type: 'kill', killer: 'a', victim: 'b' }]);
  });

  it('does not hit the shooter and is absorbed by walls', () => {
    const world = createWorld(1);
    const a = addPlayer(world, 'a');
    const wall = WALLS[0];
    if (!wall) throw new Error('no walls defined');
    a.x = wall.x - 100;
    a.y = wall.y + wall.h / 2;
    applyInput(world, 'a', input({ shoot: true, angle: 0 }), DT);
    runTicks(world, 30);
    expect(a.hp).toBe(PLAYER_MAX_HP);
    expect(world.bullets).toHaveLength(0);
  });

  it('does not tunnel through a player even at a coarse tick rate', () => {
    const { world, b } = duel();
    applyInput(world, 'a', input({ shoot: true }), DT);
    // A 10 Hz step moves the bullet 90px per step, far more than the target diameter.
    for (let i = 0; i < 10; i++) stepWorld(world, 1 / 10);
    expect(b.hp).toBe(PLAYER_MAX_HP - BULLET_DAMAGE);
  });

  it('expires bullets after their lifetime', () => {
    const world = createWorld(1);
    const a = addPlayer(world, 'a');
    // Open column at the left edge: nothing for the bullet to hit before it times out.
    a.x = 100;
    a.y = 1100;
    applyInput(world, 'a', input({ shoot: true, angle: -Math.PI / 2 }), DT);
    runTicks(world, 60);
    expect(world.bullets).toHaveLength(0);
  });

  it('cannot shoot while dead', () => {
    const { world, a } = duel();
    a.alive = false;
    a.respawnIn = RESPAWN_TIME;
    applyInput(world, 'a', input({ shoot: true }), DT);
    expect(world.bullets).toHaveLength(0);
  });
});

describe('respawn', () => {
  it('brings a dead player back with full health after RESPAWN_TIME', () => {
    const { world, b } = duel();
    b.alive = false;
    b.hp = 0;
    b.respawnIn = RESPAWN_TIME;
    runTicks(world, Math.ceil(RESPAWN_TIME / DT) + 1);
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(PLAYER_MAX_HP);
  });
});

describe('determinism', () => {
  it('produces identical worlds for identical inputs and seeds', () => {
    function simulate(): string {
      const world = createWorld(99);
      addPlayer(world, 'a');
      addPlayer(world, 'b');
      for (let i = 0; i < 200; i++) {
        applyInput(
          world,
          'a',
          input({ seq: i, mx: Math.sin(i / 10), my: Math.cos(i / 7), angle: i / 20, shoot: true }),
          DT,
        );
        applyInput(world, 'b', input({ seq: i, mx: -1, my: 0.3, angle: Math.PI, shoot: true }), DT);
        stepWorld(world, DT);
      }
      return JSON.stringify({ players: [...world.players.values()], bullets: world.bullets });
    }
    expect(simulate()).toBe(simulate());
  });
});
