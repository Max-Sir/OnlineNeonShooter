import './style.css';
import {
  DEFAULT_TICK_RATE,
  MAP_HEIGHT,
  MAP_WIDTH,
  type InputCmd,
  type ServerMessage,
  type SnapPlayer,
  type SnapshotMsg,
} from '@neon/shared';
import { Controls } from './input.js';
import { SnapshotBuffer } from './interpolation.js';
import { Net } from './net.js';
import { Predictor } from './prediction.js';
import { computeScale, Renderer, type RenderPlayer } from './render.js';
import { colorFor } from './colors.js';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from index.html`);
  return node as T;
}

const canvas = el<HTMLCanvasElement>('game');
const menu = el('menu');
const form = el<HTMLFormElement>('join-form');
const nameInput = el<HTMLInputElement>('name');
const playBtn = el<HTMLButtonElement>('play');
const statusEl = el('status');
const hud = el('hud');
const hudStats = el('hud-stats');
const scoreboard = el('scoreboard');
const killfeed = el('killfeed');
const touchRoot = el('touch');

const renderer = new Renderer(canvas);
let playing = false;
const controls = new Controls(canvas, touchRoot, () => playing);

try {
  nameInput.value = localStorage.getItem('neon-name') ?? '';
} catch {
  /* storage can be unavailable (private mode); the name just isn't remembered */
}

interface Session {
  net: Net;
  myId: string;
  tickDt: number;
  buffer: SnapshotBuffer;
  predictor: Predictor;
  names: Map<string, string>;
  latest: SnapshotMsg | null;
  seq: number;
  accumulator: number;
  lastFrame: number;
  lastAngle: number;
  lastHud: number;
  fps: number;
  raf: number;
}

let session: Session | null = null;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function showMenu(message = ''): void {
  playing = false;
  if (session) {
    cancelAnimationFrame(session.raf);
    session.net.close();
    session = null;
  }
  hud.hidden = true;
  touchRoot.hidden = true;
  menu.hidden = false;
  playBtn.disabled = false;
  setStatus(message);
}

function addKillFeed(text: string): void {
  const row = document.createElement('div');
  row.textContent = text;
  killfeed.append(row);
  while (killfeed.childElementCount > 5) killfeed.firstElementChild?.remove();
  window.setTimeout(() => row.remove(), 5000);
}

function updateHud(s: Session): void {
  const snap = s.latest;
  hudStats.textContent = `${Math.round(s.net.rttMs)} ms · ${Math.round(s.fps)} fps · ${snap?.players.length ?? 0} players`;

  if (!snap) return;
  const rows = [...snap.players]
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
    .slice(0, 8);
  scoreboard.replaceChildren(
    ...rows.map((p) => {
      const li = document.createElement('li');
      if (p.id === s.myId) li.className = 'me';
      li.style.color = p.id === s.myId ? '' : colorFor(p.id, 72);
      const name = document.createTextNode(s.names.get(p.id) ?? p.id);
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = `${p.kills} / ${p.deaths}`;
      li.append(name, score);
      return li;
    }),
  );
}

function handleMessage(s: Session, msg: ServerMessage): void {
  switch (msg.t) {
    case 'roster':
      s.names = new Map(msg.players.map((p) => [p.id, p.name]));
      break;
    case 'snap': {
      s.latest = msg;
      s.buffer.push(msg, performance.now());
      const me = msg.players.find((p) => p.id === s.myId);
      if (me) s.predictor.reconcile(me);
      break;
    }
    case 'kill': {
      const killer = s.names.get(msg.killer) ?? 'someone';
      const victim = s.names.get(msg.victim) ?? 'someone';
      addKillFeed(`${killer} ▸ ${victim}`);
      break;
    }
    case 'error':
      setStatus(msg.message);
      break;
    default:
      break;
  }
}

function frame(s: Session, now: number): void {
  const frameDt = Math.min(now - s.lastFrame, 250);
  s.lastFrame = now;
  s.fps += (1000 / Math.max(frameDt, 1) - s.fps) * 0.05;

  const input = controls.sample();
  const me = s.latest?.players.find((p) => p.id === s.myId);
  const camera = {
    x: MAP_WIDTH / 2,
    y: MAP_HEIGHT / 2,
    scale: computeScale(renderer.viewW, renderer.viewH),
  };

  if (s.predictor.ready && me) {
    camera.x = s.predictor.pos.x;
    camera.y = s.predictor.pos.y;
  }

  // Aim: mouse (converted to world space around the current camera) or the touch aim stick.
  let angle = s.lastAngle;
  if (input.touchAngle !== null) {
    angle = input.touchAngle;
  } else if (s.predictor.ready) {
    const w = renderer.screenToWorld(controls.mouse.x, controls.mouse.y, camera);
    angle = Math.atan2(w.y - s.predictor.pos.y, w.x - s.predictor.pos.x);
  }
  s.lastAngle = angle;

  // Fixed-rate input generation, identical to the server tick, so prediction matches exactly.
  s.accumulator += frameDt / 1000;
  let steps = 0;
  while (s.accumulator >= s.tickDt && steps < 5) {
    s.accumulator -= s.tickDt;
    steps++;
    const cmd: InputCmd = { seq: ++s.seq, mx: input.mx, my: input.my, angle, shoot: input.shoot };
    s.net.send({ t: 'input', ...cmd });
    if (me?.alive) s.predictor.apply(cmd);
  }
  if (steps === 5) s.accumulator = 0;

  const sample = s.buffer.sample(now);
  const players: RenderPlayer[] = (sample?.players ?? []).map(
    (p: SnapPlayer & { fresh: boolean }) => {
      const isMe = p.id === s.myId;
      return {
        ...p,
        name: s.names.get(p.id) ?? '',
        isMe,
        // Draw ourselves from the prediction so controls feel instant.
        ...(isMe && s.predictor.ready && p.alive
          ? { x: s.predictor.pos.x, y: s.predictor.pos.y, angle }
          : {}),
      };
    },
  );

  renderer.draw({ players, bullets: sample?.bullets ?? [], camera });

  if (now - s.lastHud > 250) {
    s.lastHud = now;
    updateHud(s);
  }
  s.raf = requestAnimationFrame((t) => frame(s, t));
}

async function join(name: string): Promise<void> {
  setStatus('Connecting…');
  playBtn.disabled = true;

  let resolveWelcome: (m: Extract<ServerMessage, { t: 'welcome' }>) => void = () => undefined;
  const welcomed = new Promise<Extract<ServerMessage, { t: 'welcome' }>>((r) => {
    resolveWelcome = r;
  });

  let live: Session | null = null;
  const net = new Net(Net.defaultUrl(), {
    onMessage(msg) {
      if (msg.t === 'welcome') resolveWelcome(msg);
      else if (live) handleMessage(live, msg);
      else if (msg.t === 'error') setStatus(msg.message);
    },
    onClose({ reason, wasOpen }) {
      if (!wasOpen) return; // connect() rejection already reported it
      if (session || playing)
        showMenu(reason ? `Disconnected: ${reason}` : 'Disconnected from server');
    },
  });

  try {
    await net.connect();
  } catch (err) {
    showMenu(err instanceof Error ? err.message : 'Connection failed');
    return;
  }
  net.send({ t: 'join', name });

  const welcome = await Promise.race([
    welcomed,
    new Promise<null>((r) => window.setTimeout(() => r(null), 5000)),
  ]);
  if (!welcome) {
    net.close();
    showMenu('The server did not respond');
    return;
  }

  const tickRate = welcome.tickRate || DEFAULT_TICK_RATE;
  const now = performance.now();
  live = {
    net,
    myId: welcome.id,
    tickDt: 1 / tickRate,
    buffer: new SnapshotBuffer(tickRate),
    predictor: new Predictor(1 / tickRate),
    names: new Map(),
    latest: null,
    seq: 0,
    accumulator: 0,
    lastFrame: now,
    lastAngle: 0,
    lastHud: 0,
    fps: 60,
    raf: 0,
  };
  session = live;
  playing = true;
  menu.hidden = true;
  hud.hidden = false;
  touchRoot.hidden = !matchMedia('(pointer: coarse)').matches;
  setStatus('');
  const s = live;
  s.raf = requestAnimationFrame((t) => frame(s, t));
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  try {
    localStorage.setItem('neon-name', name);
  } catch {
    /* ignore */
  }
  void join(name);
});

// Idle menu backdrop: draw the empty arena so the page is never blank.
renderer.draw({
  players: [],
  bullets: [],
  camera: {
    x: MAP_WIDTH / 2,
    y: MAP_HEIGHT / 2,
    scale: computeScale(renderer.viewW, renderer.viewH),
  },
});
window.addEventListener('resize', () => {
  if (!playing) {
    renderer.draw({
      players: [],
      bullets: [],
      camera: {
        x: MAP_WIDTH / 2,
        y: MAP_HEIGHT / 2,
        scale: computeScale(renderer.viewW, renderer.viewH),
      },
    });
  }
});
