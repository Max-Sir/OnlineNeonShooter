import {
  addPlayer,
  applyInput,
  createWorld,
  removePlayer,
  stepWorld,
  type InputCmd,
  type KillMsg,
  type RosterMsg,
  type ServerMessage,
  type SnapshotMsg,
} from '@neon/shared';
import type { Logger } from './logger.js';

/** Maximum queued inputs per client. Older inputs are dropped (prevents speed-hacking by bursting). */
const MAX_QUEUE = 4;
/** Skip snapshots for clients whose socket buffer is above this many bytes. */
const SKIP_BACKLOG = 256 * 1024;
/** Disconnect clients whose socket buffer is above this many bytes. */
const KICK_BACKLOG = 2 * 1024 * 1024;

/** What a room needs from a connection. Keeps the game loop independent from the network layer. */
export interface RoomClient {
  readonly id: string;
  readonly name: string;
  readonly queue: InputCmd[];
  send(data: string): void;
  backlog(): number;
  close(code: number, reason: string): void;
}

export interface RoomOptions {
  tickRate: number;
  snapshotDivisor: number;
  maxPlayers: number;
  seed: number;
}

export interface RoomStats {
  ticks: number;
  tickMsAvg: number;
  tickMsMax: number;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

export class Room {
  readonly world;
  private readonly clients = new Map<string, RoomClient>();
  private readonly dt: number;
  private timer: NodeJS.Timeout | null = null;
  private lastTime = 0;
  private accumulator = 0;
  private tickMsSum = 0;
  private tickCount = 0;
  private tickMsMax = 0;

  constructor(
    readonly id: string,
    private readonly opts: RoomOptions,
    private readonly log: Logger,
  ) {
    this.world = createWorld(opts.seed);
    this.dt = 1 / opts.tickRate;
  }

  get size(): number {
    return this.clients.size;
  }

  get full(): boolean {
    return this.clients.size >= this.opts.maxPlayers;
  }

  get stats(): RoomStats {
    return {
      ticks: this.tickCount,
      tickMsAvg: this.tickCount === 0 ? 0 : this.tickMsSum / this.tickCount,
      tickMsMax: this.tickMsMax,
    };
  }

  join(client: RoomClient): boolean {
    if (this.full) return false;
    this.clients.set(client.id, client);
    addPlayer(this.world, client.id);
    this.log.info('player joined', { room: this.id, player: client.id, name: client.name });
    this.broadcastRoster();
    return true;
  }

  leave(id: string): void {
    if (!this.clients.delete(id)) return;
    removePlayer(this.world, id);
    this.log.info('player left', { room: this.id, player: id });
    this.broadcastRoster();
  }

  pushInput(id: string, cmd: InputCmd): void {
    const client = this.clients.get(id);
    if (!client) return;
    client.queue.push(cmd);
    while (client.queue.length > MAX_QUEUE) client.queue.shift();
  }

  /** Start the fixed-timestep loop. Catches up after a stall, but never more than 5 ticks at once. */
  start(): void {
    if (this.timer) return;
    const tickMs = 1000 / this.opts.tickRate;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.timer = setInterval(
      () => {
        const now = performance.now();
        this.accumulator += now - this.lastTime;
        this.lastTime = now;
        let ran = 0;
        while (this.accumulator >= tickMs && ran < 5) {
          this.tick();
          this.accumulator -= tickMs;
          ran++;
        }
        if (ran === 5) this.accumulator = 0; // drop the backlog instead of spiralling
      },
      Math.max(1, Math.floor(tickMs / 2)),
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Run exactly one simulation tick. Public so tests can drive the room deterministically. */
  tick(): void {
    const started = performance.now();

    for (const client of this.clients.values()) {
      const cmd = client.queue.shift();
      if (cmd) applyInput(this.world, client.id, cmd, this.dt);
    }

    for (const ev of stepWorld(this.world, this.dt)) {
      const msg: KillMsg = { t: 'kill', killer: ev.killer, victim: ev.victim };
      this.broadcast(JSON.stringify(msg));
    }

    if (this.world.tick % this.opts.snapshotDivisor === 0) this.broadcastSnapshot();

    const elapsed = performance.now() - started;
    this.tickMsSum += elapsed;
    this.tickCount += 1;
    if (elapsed > this.tickMsMax) this.tickMsMax = elapsed;
  }

  private broadcastRoster(): void {
    const players = [...this.clients.values()].map((c) => ({ id: c.id, name: c.name }));
    const msg: RosterMsg = { t: 'roster', players };
    this.broadcast(JSON.stringify(msg));
  }

  private broadcastSnapshot(): void {
    const snap: SnapshotMsg = {
      t: 'snap',
      tick: this.world.tick,
      players: [...this.world.players.values()].map((p) => ({
        id: p.id,
        x: round1(p.x),
        y: round1(p.y),
        angle: round2(p.angle),
        hp: p.hp,
        alive: p.alive,
        kills: p.kills,
        deaths: p.deaths,
        seq: p.seq,
      })),
      bullets: this.world.bullets.map((b) => ({
        id: b.id,
        owner: b.owner,
        x: round1(b.x),
        y: round1(b.y),
        vx: Math.round(b.vx),
        vy: Math.round(b.vy),
      })),
    };
    this.broadcast(JSON.stringify(snap), true);
  }

  /** Send to every client. `droppable` frames (snapshots) are skipped for congested sockets. */
  private broadcast(data: string, droppable = false): void {
    for (const client of this.clients.values()) {
      const backlog = client.backlog();
      if (backlog > KICK_BACKLOG) {
        client.close(1013, 'too slow');
        continue;
      }
      if (droppable && backlog > SKIP_BACKLOG) continue;
      client.send(data);
    }
  }

  send(id: string, msg: ServerMessage): void {
    this.clients.get(id)?.send(JSON.stringify(msg));
  }
}
