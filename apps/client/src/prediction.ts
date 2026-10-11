import { movePlayer, type InputCmd, type SnapPlayer, type Vec2 } from '@neon/shared';

/**
 * Client-side prediction with server reconciliation.
 *
 * The local player is moved immediately using the same `movePlayer` function the server runs.
 * When an authoritative snapshot arrives, we snap to the server position and re-apply every
 * input the server has not acknowledged yet, so corrections are invisible when we agree.
 */
export class Predictor {
  readonly pos: Vec2 = { x: 0, y: 0 };
  private pending: InputCmd[] = [];
  private initialised = false;
  /** Last computed distance between prediction and server before correction (for debugging/HUD). */
  lastError = 0;

  constructor(private readonly dt: number) {}

  get ready(): boolean {
    return this.initialised;
  }

  /** Apply (and remember) a freshly generated input. */
  apply(cmd: InputCmd): void {
    this.pending.push(cmd);
    // Safety valve: if acks stop arriving, don't grow forever.
    if (this.pending.length > 120) this.pending.shift();
    if (this.initialised) movePlayer(this.pos, cmd, this.dt);
  }

  reconcile(server: SnapPlayer): void {
    if (!server.alive) {
      this.pending = [];
      this.pos.x = server.x;
      this.pos.y = server.y;
      this.initialised = true;
      return;
    }

    const before = { x: this.pos.x, y: this.pos.y };
    this.pending = this.pending.filter((c) => c.seq > server.seq);
    this.pos.x = server.x;
    this.pos.y = server.y;
    for (const cmd of this.pending) movePlayer(this.pos, cmd, this.dt);

    this.lastError = this.initialised
      ? Math.hypot(this.pos.x - before.x, this.pos.y - before.y)
      : 0;
    this.initialised = true;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
