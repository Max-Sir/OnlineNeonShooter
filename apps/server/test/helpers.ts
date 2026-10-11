import type { ServerMessage } from '@neon/shared';
import WebSocket from 'ws';
import { loadConfig, type Config } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import { createGameServer, type GameServer } from '../src/server.js';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({ PORT: '0', HOST: '127.0.0.1', LOG_LEVEL: 'error', ...overrides });
}

export async function startServer(overrides: Record<string, string> = {}): Promise<GameServer> {
  const server = createGameServer(testConfig(overrides), silentLogger);
  await server.start();
  return server;
}

/** Thin test wrapper around a WebSocket that records parsed server messages. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];
  closed: { code: number; reason: string } | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    });
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
    });
  }

  static async connect(port: number, opts: { origin?: string } = {}): Promise<TestClient> {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws`,
      opts.origin ? { origin: opts.origin } : {},
    );
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    return new TestClient(ws);
  }

  send(obj: unknown): void {
    this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  /** Resolve with the first message (already received or future) that matches the predicate. */
  waitFor<T extends ServerMessage['t']>(
    type: T,
    pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const matches = (m: ServerMessage): m is Extract<ServerMessage, { t: T }> =>
      m.t === type && pred(m as Extract<ServerMessage, { t: T }>);
    const existing = this.messages.find(matches);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for "${type}"`)), timeoutMs);
      this.waiters.push({
        pred: matches,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  waitClosed(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs);
      this.ws.once('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}
