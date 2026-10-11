import {
  BULLET_RADIUS,
  MAP_HEIGHT,
  MAP_WIDTH,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  WALLS,
  type SnapBullet,
} from '@neon/shared';
import { colorFor } from './colors.js';
import type { InterpPlayer } from './interpolation.js';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface RenderPlayer extends InterpPlayer {
  name: string;
  isMe: boolean;
}

export interface Frame {
  players: RenderPlayer[];
  bullets: SnapBullet[];
  camera: Camera;
}

/** Zoom so that roughly the same slice of the arena is visible on every screen size. */
export function computeScale(viewW: number, viewH: number): number {
  return Math.max(0.35, Math.min(viewW / 1200, viewH / 750));
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  viewW = 0;
  viewH = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.canvas.width = Math.round(this.viewW * this.dpr);
    this.canvas.height = Math.round(this.viewH * this.dpr);
  }

  screenToWorld(sx: number, sy: number, cam: Camera): { x: number; y: number } {
    return {
      x: (sx - this.viewW / 2) / cam.scale + cam.x,
      y: (sy - this.viewH / 2) / cam.scale + cam.y,
    };
  }

  draw(frame: Frame): void {
    const { ctx } = this;
    const { camera } = frame;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#060912';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    ctx.save();
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);

    this.drawArena();
    this.drawBullets(frame.bullets);
    for (const p of frame.players) this.drawPlayer(p);

    ctx.restore();
  }

  private drawArena(): void {
    const { ctx } = this;
    ctx.fillStyle = '#0b1222';
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= MAP_WIDTH; x += 100) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MAP_HEIGHT);
    }
    for (let y = 0; y <= MAP_HEIGHT; y += 100) {
      ctx.moveTo(0, y);
      ctx.lineTo(MAP_WIDTH, y);
    }
    ctx.stroke();

    ctx.fillStyle = '#16213d';
    ctx.strokeStyle = '#2d5bff';
    ctx.lineWidth = 3;
    for (const w of WALLS) {
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeRect(w.x, w.y, w.w, w.h);
    }

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  }

  private drawBullets(bullets: SnapBullet[]): void {
    const { ctx } = this;
    for (const b of bullets) {
      ctx.fillStyle = colorFor(b.owner, 75);
      ctx.beginPath();
      ctx.arc(b.x, b.y, BULLET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPlayer(p: RenderPlayer): void {
    const { ctx } = this;
    const color = colorFor(p.id);

    if (!p.alive) {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    if (p.isMe) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Gun barrel
    ctx.strokeStyle = '#0b0f1a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(
      p.x + Math.cos(p.angle) * (PLAYER_RADIUS + 8),
      p.y + Math.sin(p.angle) * (PLAYER_RADIUS + 8),
    );
    ctx.stroke();

    // Health bar
    const bw = 40;
    const frac = Math.max(0, Math.min(1, p.hp / PLAYER_MAX_HP));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(p.x - bw / 2, p.y - PLAYER_RADIUS - 16, bw, 5);
    ctx.fillStyle = frac > 0.5 ? '#4cff8f' : frac > 0.25 ? '#ffd24c' : '#ff5a5a';
    ctx.fillRect(p.x - bw / 2, p.y - PLAYER_RADIUS - 16, bw * frac, 5);

    // Name (text content is drawn on a canvas, never as HTML, so names can't inject markup)
    ctx.fillStyle = '#e8f1ff';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - PLAYER_RADIUS - 22);
  }
}
