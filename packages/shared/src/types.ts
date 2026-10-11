export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** One input command, produced by the client once per simulation tick. */
export interface InputCmd {
  /** Monotonic sequence number, echoed back in snapshots for reconciliation. */
  seq: number;
  /** Movement axes in [-1, 1]. */
  mx: number;
  my: number;
  /** Aim angle in radians. */
  angle: number;
  shoot: boolean;
}

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  alive: boolean;
  /** Seconds until respawn (only meaningful while dead). */
  respawnIn: number;
  /** Seconds until the next shot is allowed. */
  cooldown: number;
  kills: number;
  deaths: number;
  /** Sequence number of the last input applied for this player. */
  seq: number;
}

export interface BulletState {
  id: number;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining lifetime in seconds. */
  ttl: number;
}

export type SimEvent = { type: 'kill'; killer: string; victim: string };

export interface World {
  tick: number;
  players: Map<string, PlayerState>;
  bullets: BulletState[];
  nextBulletId: number;
  /** State of the deterministic PRNG (mulberry32). */
  rng: number;
}
