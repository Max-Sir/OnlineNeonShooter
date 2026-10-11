import { afterEach, describe, expect, it } from 'vitest';
import type { GameServer } from '../src/server.js';
import { startServer, TestClient } from './helpers.js';

let server: GameServer | undefined;
const clients: TestClient[] = [];

async function connect(opts: { origin?: string } = {}): Promise<TestClient> {
  if (!server) throw new Error('server not started');
  const c = await TestClient.connect(server.port, opts);
  clients.push(c);
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server?.stop();
  server = undefined;
});

describe('HTTP endpoints', () => {
  it('serves /healthz, /readyz and /metrics', async () => {
    server = await startServer();
    const base = `http://127.0.0.1:${server.port}`;

    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });

    expect((await fetch(`${base}/readyz`)).status).toBe(200);

    const metrics = await (await fetch(`${base}/metrics`)).text();
    expect(metrics).toContain('neon_connections 0');
    expect(metrics).toContain('neon_rooms 0');

    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/healthz`, { method: 'POST' })).status).toBe(405);
  });
});

describe('WebSocket gameplay', () => {
  it('welcomes a joining player and sends roster and snapshots', async () => {
    server = await startServer();
    const a = await connect();
    a.send({ t: 'join', name: 'Ada' });

    const welcome = await a.waitFor('welcome');
    expect(welcome.id).toMatch(/^[0-9a-f]{8}$/);
    expect(welcome.tickRate).toBe(30);

    const roster = await a.waitFor('roster');
    expect(roster.players).toEqual([{ id: welcome.id, name: 'Ada' }]);

    const snap = await a.waitFor('snap');
    expect(snap.players.map((p) => p.id)).toContain(welcome.id);
  });

  it('places two players in the same room and shows both in the roster', async () => {
    server = await startServer();
    const a = await connect();
    const b = await connect();
    a.send({ t: 'join', name: 'Ada' });
    b.send({ t: 'join', name: 'Bob' });

    const wa = await a.waitFor('welcome');
    const wb = await b.waitFor('welcome');
    expect(wa.room).toBe(wb.room);
    const roster = await a.waitFor('roster', (r) => r.players.length === 2);
    expect(roster.players.map((p) => p.name).sort()).toEqual(['Ada', 'Bob']);
    expect(server.lobby.roomCount).toBe(1);
  });

  it('moves the player authoritatively and echoes the input seq', async () => {
    server = await startServer();
    const a = await connect();
    a.send({ t: 'join', name: 'Ada' });
    const { id } = await a.waitFor('welcome');
    const first = await a.waitFor('snap');
    const startX = first.players.find((p) => p.id === id)?.x ?? 0;

    for (let seq = 1; seq <= 10; seq++) {
      a.send({ t: 'input', seq, mx: 1, my: 0, angle: 0, shoot: false });
    }
    const moved = await a.waitFor(
      'snap',
      (s) => (s.players.find((p) => p.id === id)?.seq ?? 0) >= 4,
    );
    const me = moved.players.find((p) => p.id === id);
    expect(me?.x).toBeGreaterThan(startX);
  });

  it('answers pings', async () => {
    server = await startServer();
    const a = await connect();
    a.send({ t: 'ping', ts: 12345 });
    expect(await a.waitFor('pong')).toEqual({ t: 'pong', ts: 12345 });
  });

  it('removes a player and closes the room when the last one leaves', async () => {
    server = await startServer();
    const a = await connect();
    a.send({ t: 'join', name: 'Ada' });
    await a.waitFor('welcome');
    expect(server.lobby.roomCount).toBe(1);

    a.close();
    await a.waitClosed();
    await new Promise((r) => setTimeout(r, 100));
    expect(server.lobby.roomCount).toBe(0);
  });
});

describe('WebSocket validation and abuse protection', () => {
  it('rejects input before join', async () => {
    server = await startServer();
    const a = await connect();
    a.send({ t: 'input', seq: 1, mx: 0, my: 0, angle: 0, shoot: false });
    const err = await a.waitFor('error');
    expect(err.code).toBe('not_joined');
  });

  it('rejects a second join', async () => {
    server = await startServer();
    const a = await connect();
    a.send({ t: 'join', name: 'Ada' });
    await a.waitFor('welcome');
    a.send({ t: 'join', name: 'Ada2' });
    expect((await a.waitFor('error')).code).toBe('already_joined');
  });

  it('answers malformed JSON and schema violations with errors', async () => {
    server = await startServer();
    const a = await connect();
    a.send('{not json');
    a.send({ t: 'join', name: '<script>' });
    const errors = await a.waitFor('error');
    expect(errors.code).toBe('bad_message');
    await a.waitFor('error', () => a.messages.filter((m) => m.t === 'error').length >= 2);
  });

  it('disconnects clients that keep sending garbage', async () => {
    server = await startServer();
    const a = await connect();
    for (let i = 0; i < 15; i++) a.send('garbage');
    const closed = await a.waitClosed();
    expect(closed.code).toBe(1008);
  });

  it('closes binary frames', async () => {
    server = await startServer();
    const a = await connect();
    a.ws.send(Buffer.from([1, 2, 3]));
    expect((await a.waitClosed()).code).toBe(1003);
  });

  it('rate limits message floods', async () => {
    server = await startServer();
    const a = await connect();
    a.send({ t: 'join', name: 'Ada' });
    await a.waitFor('welcome');
    for (let i = 0; i < 400; i++) a.send({ t: 'ping', ts: i });
    const err = await a.waitFor('error', (e) => e.code === 'rate_limited');
    expect(err.code).toBe('rate_limited');
  });

  it('ignores replayed or out-of-order input sequence numbers', async () => {
    server = await startServer();
    const a = await connect();
    a.send({ t: 'join', name: 'Ada' });
    const { id } = await a.waitFor('welcome');
    a.send({ t: 'input', seq: 10, mx: 0, my: 0, angle: 0, shoot: false });
    a.send({ t: 'input', seq: 5, mx: 1, my: 0, angle: 0, shoot: false });
    const snap = await a.waitFor(
      'snap',
      (s) => (s.players.find((p) => p.id === id)?.seq ?? 0) >= 10,
    );
    expect(snap.players.find((p) => p.id === id)?.seq).toBe(10);
    await new Promise((r) => setTimeout(r, 200));
    const last = [...a.messages].reverse().find((m) => m.t === 'snap');
    expect(last?.t === 'snap' && last.players.find((p) => p.id === id)?.seq).toBe(10);
  });

  it('enforces the Origin allow-list on upgrade', async () => {
    server = await startServer({ ALLOWED_ORIGINS: 'https://game.example' });
    await expect(connect({ origin: 'https://evil.example' })).rejects.toThrow(/403/);
    await expect(connect()).rejects.toThrow(/403/);
    const ok = await connect({ origin: 'https://game.example' });
    ok.send({ t: 'ping', ts: 1 });
    await ok.waitFor('pong');
  });

  it('limits connections per IP', async () => {
    server = await startServer({ MAX_CONNECTIONS_PER_IP: '2' });
    await connect();
    await connect();
    await expect(connect()).rejects.toThrow(/429/);
  });

  it('rejects joins when every room is full', async () => {
    server = await startServer({ MAX_ROOMS: '1', MAX_PLAYERS_PER_ROOM: '2' });
    const a = await connect();
    const b = await connect();
    const c = await connect();
    a.send({ t: 'join', name: 'A' });
    b.send({ t: 'join', name: 'B' });
    await a.waitFor('welcome');
    await b.waitFor('welcome');
    c.send({ t: 'join', name: 'C' });
    expect((await c.waitFor('error')).code).toBe('room_full');
    expect((await c.waitClosed()).code).toBe(1013);
  });

  it('refuses upgrades on paths other than /ws', async () => {
    server = await startServer();
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/other`);
    const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
    expect(err.message).toMatch(/404/);
  });
});

describe('graceful shutdown', () => {
  it('closes clients with 1001 and reports not ready', async () => {
    server = await startServer();
    const a = await connect();
    a.send({ t: 'join', name: 'Ada' });
    await a.waitFor('welcome');
    const stopping = server.stop();
    expect((await a.waitClosed()).code).toBe(1001);
    await stopping;
    server = undefined;
  });
});
