import type { Rect, Vec2 } from './types.js';

export const DEFAULT_TICK_RATE = 30;

export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 1200;

export const PLAYER_RADIUS = 16;
/** Pixels per second. */
export const PLAYER_SPEED = 260;
export const PLAYER_MAX_HP = 100;

export const BULLET_SPEED = 900;
export const BULLET_RADIUS = 4;
export const BULLET_TTL = 1.1;
export const BULLET_DAMAGE = 25;
export const FIRE_COOLDOWN = 0.2;
export const RESPAWN_TIME = 3;

export const MAX_NAME_LENGTH = 16;

/** Static obstacles. They block players and absorb bullets. */
export const WALLS: readonly Rect[] = [
  { x: 900, y: 500, w: 200, h: 200 },
  { x: 300, y: 250, w: 120, h: 120 },
  { x: 1580, y: 250, w: 120, h: 120 },
  { x: 300, y: 830, w: 120, h: 120 },
  { x: 1580, y: 830, w: 120, h: 120 },
  { x: 650, y: 150, w: 40, h: 300 },
  { x: 1310, y: 750, w: 40, h: 300 },
  { x: 1200, y: 200, w: 300, h: 40 },
  { x: 500, y: 960, w: 300, h: 40 },
];

export const SPAWN_POINTS: readonly Vec2[] = [
  { x: 120, y: 120 },
  { x: 1880, y: 120 },
  { x: 120, y: 1080 },
  { x: 1880, y: 1080 },
  { x: 1000, y: 150 },
  { x: 1000, y: 1050 },
  { x: 200, y: 600 },
  { x: 1800, y: 600 },
];
