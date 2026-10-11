import { randomBytes } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import {
  clientMessageSchema,
  type ClientMessage,
  type InputCmd,
  type ServerMessage,
} from '@neon/shared';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { Config } from './config.js';
import { Lobby } from './lobby.js';
import type { Logger } from './logger.js';
import { TokenBucket } from './rate-limiter.js';
import type { Room, RoomClient } from './room.js';

const HEARTBEAT_MS = 15_000;
const JOIN_TIMEOUT_MS = 10_000;
/** 30 inputs/s are expected; allow headroom for pings and jitter bursts. */
const BUCKET_CAPACITY = 100;
const BUCKET_RATE = 100;
const MAX_BAD_MESSAGES = 10;
const MAX_RATE_VIOLATIONS = 50;

export interface GameServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The bound TCP port (useful when started with PORT=0). */
  readonly port: number;
  readonly lobby: Lobby;
}

class Connection implements RoomClient {
  readonly id = randomBytes(4).toString('hex');
  name = '';
  readonly queue: InputCmd[] = [];
  room: Room | null = null;
  lastSeq = -1;
  alive = true;
  badMessages = 0;
  rateViolations = 0;
  joinTimer: NodeJS.Timeout | null = null;
  readonly bucket = new TokenBucket(BUCKET_CAPACITY, BUCKET_RATE);

  constructor(
    readonly ws: WebSocket,
    readonly ip: string,
  ) {}

  send(data: string): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(data);
  }

  sendMsg(msg: ServerMessage): void {
    this.send(JSON.stringify(msg));
  }

  backlog(): number {
    return this.ws.bufferedAmount;
  }

  close(code: number, reason: string): void {
    this.ws.close(code, reason);
  }
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createGameServer(config: Config, log: Logger): GameServer {
  const lobby = new Lobby(config, log);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const connections = new Set<Connection>();
  const perIp = new Map<string, number>();
  const startedAt = Date.now();
  let shuttingDown = false;
  let heartbeat: NodeJS.Timeout | null = null;
  let boundPort = config.PORT;

  const counters = {
    connections: 0,
    messages: 0,
    badMessages: 0,
    rateLimited: 0,
    rejectedUpgrades: 0,
  };

  function clientIp(req: IncomingMessage): string {
    if (config.TRUST_PROXY) {
      const xff = req.headers['x-forwarded-for'];
      const value = Array.isArray(xff) ? xff.join(',') : xff;
      // The last entry is the one appended by our own trusted proxy; earlier ones can be spoofed.
      const last = value?.split(',').at(-1)?.trim();
      if (last) return last;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function metricsText(): string {
    const lines = [
      '# TYPE neon_connections gauge',
      `neon_connections ${connections.size}`,
      '# TYPE neon_rooms gauge',
      `neon_rooms ${lobby.roomCount}`,
      '# TYPE neon_players gauge',
      `neon_players ${lobby.playerCount}`,
      '# TYPE neon_connections_total counter',
      `neon_connections_total ${counters.connections}`,
      '# TYPE neon_messages_total counter',
      `neon_messages_total ${counters.messages}`,
      '# TYPE neon_bad_messages_total counter',
      `neon_bad_messages_total ${counters.badMessages}`,
      '# TYPE neon_rate_limited_total counter',
      `neon_rate_limited_total ${counters.rateLimited}`,
      '# TYPE neon_rejected_upgrades_total counter',
      `neon_rejected_upgrades_total ${counters.rejectedUpgrades}`,
      '# TYPE neon_tick_ms_avg gauge',
      '# TYPE neon_tick_ms_max gauge',
    ];
    for (const room of lobby.all()) {
      const s = room.stats;
      lines.push(`neon_tick_ms_avg{room="${room.id}"} ${s.tickMsAvg.toFixed(4)}`);
      lines.push(`neon_tick_ms_max{room="${room.id}"} ${s.tickMsMax.toFixed(4)}`);
    }
    return `${lines.join('\n')}\n`;
  }

  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? '/').split('?')[0];
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    switch (path) {
      case '/healthz':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          }),
        );
        return;
      case '/readyz':
        res.writeHead(shuttingDown ? 503 : 200, { 'Content-Type': 'text/plain' });
        res.end(shuttingDown ? 'shutting down\n' : 'ready\n');
        return;
      case '/metrics':
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(metricsText());
        return;
      default:
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found\n');
    }
  }

  function handleMessage(conn: Connection, msg: ClientMessage): void {
    switch (msg.t) {
      case 'ping':
        conn.sendMsg({ t: 'pong', ts: msg.ts });
        return;

      case 'join': {
        if (conn.room) {
          conn.sendMsg({ t: 'error', code: 'already_joined', message: 'Already joined a room' });
          return;
        }
        const room = lobby.assign();
        if (!room) {
          conn.sendMsg({ t: 'error', code: 'room_full', message: 'All rooms are full' });
          conn.close(1013, 'room full');
          return;
        }
        conn.name = msg.name;
        conn.room = room;
        if (conn.joinTimer) clearTimeout(conn.joinTimer);
        conn.joinTimer = null;
        // Welcome first so the client knows its id before the first roster/snapshot arrives.
        conn.sendMsg({ t: 'welcome', id: conn.id, room: room.id, tickRate: config.TICK_RATE });
        room.join(conn);
        return;
      }

      case 'input': {
        if (!conn.room) {
          conn.sendMsg({ t: 'error', code: 'not_joined', message: 'Send "join" first' });
          return;
        }
        if (msg.seq <= conn.lastSeq) return; // replayed or reordered input
        conn.lastSeq = msg.seq;
        conn.room.pushInput(conn.id, {
          seq: msg.seq,
          mx: msg.mx,
          my: msg.my,
          angle: msg.angle,
          shoot: msg.shoot,
        });
        return;
      }
    }
  }

  function onBadMessage(conn: Connection, message: string): void {
    counters.badMessages++;
    conn.badMessages++;
    conn.sendMsg({ t: 'error', code: 'bad_message', message });
    if (conn.badMessages > MAX_BAD_MESSAGES) conn.close(1008, 'protocol violations');
  }

  function handleConnection(ws: WebSocket, ip: string): void {
    const conn = new Connection(ws, ip);
    connections.add(conn);
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    counters.connections++;
    log.debug('connection opened', { conn: conn.id, ip });

    conn.joinTimer = setTimeout(() => {
      if (!conn.room) conn.close(1008, 'join timeout');
    }, JOIN_TIMEOUT_MS);

    ws.on('pong', () => {
      conn.alive = true;
    });

    ws.on('message', (data, isBinary) => {
      counters.messages++;
      if (!conn.bucket.take()) {
        counters.rateLimited++;
        conn.rateViolations++;
        if (conn.rateViolations === 1) {
          conn.sendMsg({ t: 'error', code: 'rate_limited', message: 'Too many messages' });
        }
        if (conn.rateViolations > MAX_RATE_VIOLATIONS) conn.close(1008, 'rate limit exceeded');
        return;
      }
      if (isBinary) {
        conn.close(1003, 'text frames only');
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(rawToString(data));
      } catch {
        onBadMessage(conn, 'Invalid JSON');
        return;
      }
      const parsed = clientMessageSchema.safeParse(json);
      if (!parsed.success) {
        onBadMessage(conn, 'Invalid message');
        return;
      }
      handleMessage(conn, parsed.data);
    });

    ws.on('error', (err) => {
      log.debug('socket error', { conn: conn.id, error: err.message });
    });

    ws.on('close', () => {
      if (conn.joinTimer) clearTimeout(conn.joinTimer);
      connections.delete(conn);
      const remaining = (perIp.get(ip) ?? 1) - 1;
      if (remaining <= 0) perIp.delete(ip);
      else perIp.set(ip, remaining);
      if (conn.room) lobby.leave(conn.room, conn.id);
      log.debug('connection closed', { conn: conn.id });
    });
  }

  const http: HttpServer = createServer(handleHttp);

  http.on('upgrade', (req, socket, head) => {
    const reject = (status: number, text: string): void => {
      counters.rejectedUpgrades++;
      rejectUpgrade(socket, status, text);
    };
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/ws') return reject(404, 'Not Found');
    if (shuttingDown) return reject(503, 'Service Unavailable');

    if (config.ALLOWED_ORIGINS.length > 0) {
      const origin = req.headers.origin;
      if (!origin || !config.ALLOWED_ORIGINS.includes(origin)) return reject(403, 'Forbidden');
    }

    const ip = clientIp(req);
    if ((perIp.get(ip) ?? 0) >= config.MAX_CONNECTIONS_PER_IP) {
      return reject(429, 'Too Many Requests');
    }

    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, ip));
  });

  return {
    get port() {
      return boundPort;
    },
    lobby,

    start() {
      return new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(config.PORT, config.HOST, () => {
          http.off('error', reject);
          boundPort = (http.address() as AddressInfo).port;
          heartbeat = setInterval(() => {
            for (const conn of connections) {
              if (!conn.alive) {
                conn.ws.terminate();
                continue;
              }
              conn.alive = false;
              conn.ws.ping();
            }
          }, HEARTBEAT_MS);
          log.info('server listening', {
            host: config.HOST,
            port: boundPort,
            tickRate: config.TICK_RATE,
          });
          resolve();
        });
      });
    },

    async stop() {
      shuttingDown = true;
      if (heartbeat) clearInterval(heartbeat);
      for (const conn of connections) conn.close(1001, 'server shutting down');
      lobby.stopAll();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
      log.info('server stopped');
    },
  };
}
