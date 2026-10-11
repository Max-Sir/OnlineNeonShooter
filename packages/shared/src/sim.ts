import {
  BULLET_DAMAGE,
  BULLET_SPEED,
  BULLET_TTL,
  FIRE_COOLDOWN,
  MAP_HEIGHT,
  MAP_WIDTH,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  RESPAWN_TIME,
  SPAWN_POINTS,
  WALLS,
  BULLET_RADIUS,
} from './constants.js';
import { clamp, mulberry32, resolveCircleRect, segmentCircleT, segmentRectT } from './math.js';
import type { BulletState, InputCmd, PlayerState, SimEvent, Vec2, World } from './types.js';

export function createWorld(seed = 1): World {
  return { tick: 0, players: new Map(), bullets: [], nextBulletId: 1, rng: seed >>> 0 };
}

function random(world: World): number {
  const { state, value } = mulberry32(world.rng);
  world.rng = state;
  return value;
}

/** Pick the spawn point that is farthest from every living player (with a little randomness). */
export function pickSpawn(world: World): Vec2 {
  let best: Vec2 = SPAWN_POINTS[0] ?? { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
  let bestScore = -Infinity;
  for (const sp of SPAWN_POINTS) {
    let minDist = Infinity;
    for (const p of world.players.values()) {
      if (!p.alive) continue;
      minDist = Math.min(minDist, Math.hypot(p.x - sp.x, p.y - sp.y));
    }
    const score = (Number.isFinite(minDist) ? minDist : 1000) + random(world) * 50;
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  return { x: best.x, y: best.y };
}

export function addPlayer(world: World, id: string): PlayerState {
  const spawn = pickSpawn(world);
  const player: PlayerState = {
    id,
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    hp: PLAYER_MAX_HP,
    alive: true,
    respawnIn: 0,
    cooldown: 0,
    kills: 0,
    deaths: 0,
    seq: 0,
  };
  world.players.set(id, player);
  return player;
}

export function removePlayer(world: World, id: string): void {
  world.players.delete(id);
  world.bullets = world.bullets.filter((b) => b.owner !== id);
}

/**
 * Move a player for one input. Pure position update shared by the server (authoritative)
 * and the client (prediction), so both produce identical results for identical inputs.
 */
export function movePlayer(p: Vec2, input: Pick<InputCmd, 'mx' | 'my'>, dt: number): void {
  let mx = Number.isFinite(input.mx) ? clamp(input.mx, -1, 1) : 0;
  let my = Number.isFinite(input.my) ? clamp(input.my, -1, 1) : 0;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }

  p.x += mx * PLAYER_SPEED * dt;
  p.y += my * PLAYER_SPEED * dt;

  p.x = clamp(p.x, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
  p.y = clamp(p.y, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);

  // Two passes make corner contacts between neighbouring walls stable.
  for (let i = 0; i < 2; i++) {
    for (const wall of WALLS) resolveCircleRect(p, PLAYER_RADIUS, wall);
  }
  p.x = clamp(p.x, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
  p.y = clamp(p.y, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
}

function sanitizeAngle(angle: number): number {
  return Number.isFinite(angle) ? clamp(angle, -Math.PI * 2, Math.PI * 2) : 0;
}

/** Apply one input command to a player: movement, aiming and shooting. */
export function applyInput(world: World, id: string, input: InputCmd, dt: number): void {
  const p = world.players.get(id);
  if (!p) return;
  p.seq = input.seq;
  if (!p.alive) return;

  movePlayer(p, input, dt);
  p.angle = sanitizeAngle(input.angle);

  if (input.shoot && p.cooldown <= 0) {
    p.cooldown = FIRE_COOLDOWN;
    world.bullets.push({
      id: world.nextBulletId++,
      owner: id,
      x: p.x,
      y: p.y,
      vx: Math.cos(p.angle) * BULLET_SPEED,
      vy: Math.sin(p.angle) * BULLET_SPEED,
      ttl: BULLET_TTL,
    });
  }
}

/** Advance bullets, cooldowns and respawn timers by one tick. Returns events that happened. */
export function stepWorld(world: World, dt: number): SimEvent[] {
  const events: SimEvent[] = [];

  for (const p of world.players.values()) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (!p.alive) {
      p.respawnIn -= dt;
      if (p.respawnIn <= 0) {
        const spawn = pickSpawn(world);
        p.x = spawn.x;
        p.y = spawn.y;
        p.hp = PLAYER_MAX_HP;
        p.alive = true;
        p.respawnIn = 0;
        p.cooldown = 0;
      }
    }
  }

  const survivors: BulletState[] = [];
  for (const b of world.bullets) {
    const x0 = b.x;
    const y0 = b.y;
    const x1 = x0 + b.vx * dt;
    const y1 = y0 + b.vy * dt;

    let hitT = Infinity;
    let hitPlayer: PlayerState | null = null;

    for (const wall of WALLS) {
      const t = segmentRectT(x0, y0, x1, y1, wall);
      if (t !== null && t < hitT) {
        hitT = t;
        hitPlayer = null;
      }
    }
    for (const p of world.players.values()) {
      if (!p.alive || p.id === b.owner) continue;
      const t = segmentCircleT(x0, y0, x1, y1, p.x, p.y, PLAYER_RADIUS + BULLET_RADIUS);
      if (t !== null && t < hitT) {
        hitT = t;
        hitPlayer = p;
      }
    }

    if (hitPlayer) {
      hitPlayer.hp -= BULLET_DAMAGE;
      if (hitPlayer.hp <= 0) {
        hitPlayer.hp = 0;
        hitPlayer.alive = false;
        hitPlayer.respawnIn = RESPAWN_TIME;
        hitPlayer.deaths += 1;
        const killer = world.players.get(b.owner);
        if (killer) killer.kills += 1;
        events.push({ type: 'kill', killer: b.owner, victim: hitPlayer.id });
      }
      continue; // bullet consumed
    }
    if (hitT !== Infinity) continue; // absorbed by a wall

    b.x = x1;
    b.y = y1;
    b.ttl -= dt;
    if (b.ttl <= 0 || b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT) continue;
    survivors.push(b);
  }
  world.bullets = survivors;
  world.tick += 1;
  return events;
}
