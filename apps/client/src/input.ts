import { clamp } from '@neon/shared';

export interface InputSample {
  mx: number;
  my: number;
  /** Aim direction from touch aim-stick (radians), or null when the mouse should be used. */
  touchAngle: number | null;
  shoot: boolean;
}

/** Normalised stick vector (length <= 1) from a pointer offset relative to the stick centre. */
export function stickVector(dx: number, dy: number, radius: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: 0 };
  const m = clamp(len / radius, 0, 1);
  return { x: (dx / len) * m, y: (dy / len) * m };
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

interface Stick {
  el: HTMLElement;
  knob: HTMLElement;
  pointerId: number | null;
  vec: { x: number; y: number };
}

/** Keyboard + mouse + dual-stick touch input collector. */
export class Controls {
  readonly mouse = { x: 0, y: 0 };
  private readonly keys = new Set<string>();
  private mouseDown = false;
  private readonly moveStick: Stick;
  private readonly aimStick: Stick;
  usingTouch = false;

  constructor(
    canvas: HTMLCanvasElement,
    touchRoot: HTMLElement,
    private readonly isActive: () => boolean,
  ) {
    window.addEventListener('keydown', (e) => {
      if (!this.isActive()) return;
      if (e.code in MOVE_KEYS || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
        this.mouseDown = true;
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') this.mouseDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.moveStick = this.bindStick(touchRoot.querySelector('#stick-move'));
    this.aimStick = this.bindStick(touchRoot.querySelector('#stick-aim'));
  }

  private bindStick(el: Element | null): Stick {
    if (!(el instanceof HTMLElement)) throw new Error('stick element missing');
    const knob = el.querySelector('.knob');
    if (!(knob instanceof HTMLElement)) throw new Error('knob element missing');
    const stick: Stick = { el, knob, pointerId: null, vec: { x: 0, y: 0 } };

    const update = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect();
      const radius = r.width / 2;
      stick.vec = stickVector(e.clientX - (r.left + radius), e.clientY - (r.top + radius), radius);
      knob.style.transform = `translate(${stick.vec.x * radius * 0.7}px, ${stick.vec.y * radius * 0.7}px)`;
    };
    const reset = (): void => {
      stick.pointerId = null;
      stick.vec = { x: 0, y: 0 };
      knob.style.transform = '';
    };

    el.addEventListener('pointerdown', (e) => {
      this.usingTouch = true;
      stick.pointerId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      update(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === stick.pointerId) update(e);
    });
    el.addEventListener('pointerup', reset);
    el.addEventListener('pointercancel', reset);
    return stick;
  }

  sample(): InputSample {
    let mx = 0;
    let my = 0;
    for (const code of this.keys) {
      const v = MOVE_KEYS[code];
      if (v) {
        mx += v[0];
        my += v[1];
      }
    }
    mx = clamp(mx + this.moveStick.vec.x, -1, 1);
    my = clamp(my + this.moveStick.vec.y, -1, 1);

    const aim = this.aimStick.vec;
    const aimMag = Math.hypot(aim.x, aim.y);
    const touchAiming = aimMag > 0.25;

    return {
      mx,
      my,
      touchAngle: touchAiming ? Math.atan2(aim.y, aim.x) : null,
      shoot: this.mouseDown || this.keys.has('Space') || touchAiming,
    };
  }
}
