/**
 * Load / smoke-test tool: connects N bots that wander and shoot.
 *
 *   pnpm --filter @neon/server bots -- --url ws://localhost:8080/ws --count 24 --seconds 30
 *
 * Prints how many snapshots each bot received and its average snapshot interval.
 * Exits with a non-zero code if fewer than 90% of bots stayed connected.
 */
import type { ServerMessage } from '@neon/shared';
import WebSocket from 'ws';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value ?? fallback;
}

const url = arg('url', 'ws://localhost:8080/ws');
const count = Number(arg('count', '16'));
const seconds = Number(arg('seconds', '20'));
const origin = arg('origin', '');

interface BotStats {
  snaps: number;
  kills: number;
  lastSnapAt: number;
  gaps: number[];
  connected: boolean;
  error?: string;
}

function startBot(index: number): Promise<BotStats> {
  const stats: BotStats = { snaps: 0, kills: 0, lastSnapAt: 0, gaps: [], connected: false };
  return new Promise((resolve) => {
    const ws = new WebSocket(url, origin ? { origin } : {});
    let seq = 0;
    let timer: NodeJS.Timeout | undefined;
    let angle = Math.random() * Math.PI * 2;
    let mx = 1;
    let my = 0;

    const finish = (): void => {
      if (timer) clearInterval(timer);
      resolve(stats);
    };

    ws.on('open', () => {
      stats.connected = true;
      ws.send(JSON.stringify({ t: 'join', name: `bot-${index}` }));
      timer = setInterval(() => {
        if (Math.random() < 0.05) {
          const a = Math.random() * Math.PI * 2;
          mx = Math.cos(a);
          my = Math.sin(a);
        }
        angle += (Math.random() - 0.5) * 0.6;
        // Keep the angle in [-π, π]; the server rejects values outside its validated range.
        angle = Math.atan2(Math.sin(angle), Math.cos(angle));
        ws.send(
          JSON.stringify({ t: 'input', seq: ++seq, mx, my, angle, shoot: Math.random() < 0.4 }),
        );
      }, 1000 / 30);
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.t === 'snap') {
        const now = performance.now();
        if (stats.lastSnapAt) stats.gaps.push(now - stats.lastSnapAt);
        stats.lastSnapAt = now;
        stats.snaps++;
      } else if (msg.t === 'kill') {
        stats.kills++;
      }
    });

    ws.on('error', (err) => {
      stats.error = err.message;
      finish();
    });
    ws.on('close', () => {
      stats.connected = false;
      finish();
    });

    setTimeout(() => ws.close(), seconds * 1000);
  });
}

const results = await Promise.all(Array.from({ length: count }, (_, i) => startBot(i)));
const ok = results.filter((r) => r.snaps > 0 && !r.error);
const gaps = ok.flatMap((r) => r.gaps).sort((a, b) => a - b);
const pct = (p: number): number => gaps[Math.floor((gaps.length - 1) * p)] ?? 0;

console.log(
  JSON.stringify(
    {
      url,
      bots: count,
      seconds,
      botsWithSnapshots: ok.length,
      totalSnapshots: results.reduce((s, r) => s + r.snaps, 0),
      totalKills: results.reduce((s, r) => s + r.kills, 0) / 2,
      snapshotGapMs: {
        p50: Math.round(pct(0.5)),
        p95: Math.round(pct(0.95)),
        max: Math.round(pct(1)),
      },
      errors: results.filter((r) => r.error).map((r) => r.error),
    },
    null,
    2,
  ),
);
process.exit(ok.length >= count * 0.9 ? 0 : 1);
