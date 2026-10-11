import { z } from 'zod';
import { MAX_NAME_LENGTH } from './constants.js';

// ---------------------------------------------------------------------------
// Client -> server (validated with zod on the server; never trust the client)
// ---------------------------------------------------------------------------

export const playerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NAME_LENGTH)
  .regex(/^[\p{L}\p{N} _-]+$/u, 'Only letters, numbers, spaces, "_" and "-" are allowed');

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('join'), name: playerNameSchema }),
  z.object({
    t: z.literal('input'),
    seq: z.number().int().min(0).max(2_000_000_000),
    mx: z.number().min(-1).max(1),
    my: z.number().min(-1).max(1),
    angle: z.number().min(-7).max(7),
    shoot: z.boolean(),
  }),
  z.object({ t: z.literal('ping'), ts: z.number().finite() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Server -> client (plain typed JSON; the client trusts its server)
// ---------------------------------------------------------------------------

export interface WelcomeMsg {
  t: 'welcome';
  id: string;
  room: string;
  tickRate: number;
}

export interface RosterMsg {
  t: 'roster';
  players: { id: string; name: string }[];
}

export interface SnapPlayer {
  id: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  /** Last input sequence number the server applied for this player. */
  seq: number;
}

export interface SnapBullet {
  id: number;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SnapshotMsg {
  t: 'snap';
  tick: number;
  players: SnapPlayer[];
  bullets: SnapBullet[];
}

export interface KillMsg {
  t: 'kill';
  killer: string;
  victim: string;
}

export interface PongMsg {
  t: 'pong';
  ts: number;
}

export interface ErrorMsg {
  t: 'error';
  code: 'bad_message' | 'rate_limited' | 'room_full' | 'not_joined' | 'already_joined';
  message: string;
}

export type ServerMessage = WelcomeMsg | RosterMsg | SnapshotMsg | KillMsg | PongMsg | ErrorMsg;
