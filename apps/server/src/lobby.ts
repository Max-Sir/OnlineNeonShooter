import { randomInt } from 'node:crypto';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { Room } from './room.js';

/** Owns all rooms: picks a room for a joining player and tears down empty ones. */
export class Lobby {
  private readonly rooms = new Map<string, Room>();
  private nextRoomNumber = 1;

  constructor(
    private readonly config: Pick<
      Config,
      'TICK_RATE' | 'SNAPSHOT_DIVISOR' | 'MAX_PLAYERS_PER_ROOM' | 'MAX_ROOMS'
    >,
    private readonly log: Logger,
  ) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  get playerCount(): number {
    let n = 0;
    for (const room of this.rooms.values()) n += room.size;
    return n;
  }

  all(): IterableIterator<Room> {
    return this.rooms.values();
  }

  /**
   * Find a room with a free slot (fullest first, so players cluster together) or create one.
   * Returns null when every room is full and the room limit has been reached.
   */
  assign(): Room | null {
    let best: Room | null = null;
    for (const room of this.rooms.values()) {
      if (room.full) continue;
      if (!best || room.size > best.size) best = room;
    }
    if (best) return best;
    if (this.rooms.size >= this.config.MAX_ROOMS) return null;

    const room = new Room(
      `arena-${this.nextRoomNumber++}`,
      {
        tickRate: this.config.TICK_RATE,
        snapshotDivisor: this.config.SNAPSHOT_DIVISOR,
        maxPlayers: this.config.MAX_PLAYERS_PER_ROOM,
        seed: randomInt(1, 2 ** 31),
      },
      this.log,
    );
    this.rooms.set(room.id, room);
    room.start();
    this.log.info('room created', { room: room.id });
    return room;
  }

  /** Remove a player and dispose of the room when it becomes empty. */
  leave(room: Room, playerId: string): void {
    room.leave(playerId);
    if (room.size === 0) {
      room.stop();
      this.rooms.delete(room.id);
      this.log.info('room closed', { room: room.id });
    }
  }

  stopAll(): void {
    for (const room of this.rooms.values()) room.stop();
    this.rooms.clear();
  }
}
