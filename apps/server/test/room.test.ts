import type { InputCmd } from '@neon/shared';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../src/logger.js';
import { Room, type RoomClient } from '../src/room.js';

class FakeClient implements RoomClient {
  readonly queue: InputCmd[] = [];
  readonly sent: string[] = [];
  closedWith: number | null = null;
  backlogBytes = 0;

  constructor(
    readonly id: string,
    readonly name = id,
  ) {}

  send(data: string): void {
    this.sent.push(data);
  }
  backlog(): number {
    return this.backlogBytes;
  }
  close(code: number): void {
    this.closedWith = code;
  }
  messages(type: string): Record<string, unknown>[] {
    return this.sent
      .map((s) => JSON.parse(s) as Record<string, unknown>)
      .filter((m) => m.t === type);
  }
}

function makeRoom(maxPlayers = 4, snapshotDivisor = 2): Room {
  return new Room('r1', { tickRate: 30, snapshotDivisor, maxPlayers, seed: 1 }, silentLogger);
}

const cmd = (seq: number, extra: Partial<InputCmd> = {}): InputCmd => ({
  seq,
  mx: 0,
  my: 0,
  angle: 0,
  shoot: false,
  ...extra,
});

describe('Room', () => {
  it('enforces the player limit', () => {
    const room = makeRoom(2);
    expect(room.join(new FakeClient('a'))).toBe(true);
    expect(room.join(new FakeClient('b'))).toBe(true);
    expect(room.full).toBe(true);
    expect(room.join(new FakeClient('c'))).toBe(false);
    expect(room.size).toBe(2);
  });

  it('broadcasts a roster when players join and leave', () => {
    const room = makeRoom();
    const a = new FakeClient('a', 'Ann');
    const b = new FakeClient('b', 'Bob');
    room.join(a);
    room.join(b);
    const lastRoster = a.messages('roster').at(-1) as { players: { id: string; name: string }[] };
    expect(lastRoster.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);

    room.leave('b');
    const afterLeave = a.messages('roster').at(-1) as { players: unknown[] };
    expect(afterLeave.players).toHaveLength(1);
  });

  it('sends snapshots every SNAPSHOT_DIVISOR ticks', () => {
    const room = makeRoom(4, 2);
    const a = new FakeClient('a');
    room.join(a);
    for (let i = 0; i < 6; i++) room.tick();
    expect(a.messages('snap')).toHaveLength(3);
  });

  it('applies exactly one queued input per tick and echoes its seq', () => {
    const room = makeRoom(4, 1);
    const a = new FakeClient('a');
    room.join(a);
    room.pushInput('a', cmd(1, { mx: 1 }));
    room.pushInput('a', cmd(2, { mx: 1 }));
    room.tick();
    expect(room.world.players.get('a')?.seq).toBe(1);
    room.tick();
    expect(room.world.players.get('a')?.seq).toBe(2);
  });

  it('caps the input queue so bursts cannot speed-hack', () => {
    const room = makeRoom();
    const a = new FakeClient('a');
    room.join(a);
    for (let i = 1; i <= 50; i++) room.pushInput('a', cmd(i));
    expect(a.queue.length).toBeLessThanOrEqual(4);
    expect(a.queue.at(-1)?.seq).toBe(50);
  });

  it('skips snapshots for congested clients and kicks hopeless ones', () => {
    const room = makeRoom(4, 1);
    const slow = new FakeClient('slow');
    const dead = new FakeClient('dead');
    room.join(slow);
    room.join(dead);
    slow.backlogBytes = 300 * 1024;
    dead.backlogBytes = 5 * 1024 * 1024;
    const before = slow.messages('snap').length;
    room.tick();
    expect(slow.messages('snap').length).toBe(before);
    expect(dead.closedWith).toBe(1013);
  });

  it('broadcasts kills', () => {
    const room = makeRoom(4, 1);
    const a = new FakeClient('a');
    const b = new FakeClient('b');
    room.join(a);
    room.join(b);
    const pa = room.world.players.get('a');
    const pb = room.world.players.get('b');
    if (!pa || !pb) throw new Error('players missing');
    pa.x = 500;
    pa.y = 600;
    pb.x = 700;
    pb.y = 600;
    pb.hp = 25; // one hit from death

    room.pushInput('a', cmd(1, { shoot: true, angle: 0 }));
    for (let i = 0; i < 10; i++) room.tick();
    expect(a.messages('kill')).toEqual([{ t: 'kill', killer: 'a', victim: 'b' }]);
  });

  it('tracks tick timing stats', () => {
    const room = makeRoom();
    room.join(new FakeClient('a'));
    room.tick();
    room.tick();
    expect(room.stats.ticks).toBe(2);
    expect(room.stats.tickMsMax).toBeGreaterThanOrEqual(room.stats.tickMsAvg);
  });
});
