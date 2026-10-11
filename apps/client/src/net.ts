import type { ClientMessage, ServerMessage } from '@neon/shared';

export interface NetHandlers {
  onMessage(msg: ServerMessage): void;
  onClose(info: { code: number; reason: string; wasOpen: boolean }): void;
}

/** Thin typed wrapper around the game WebSocket plus RTT measurement. */
export class Net {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  rttMs = 0;

  constructor(
    private readonly url: string,
    private readonly handlers: NetHandlers,
  ) {}

  static defaultUrl(): string {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}/ws`;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        this.pingTimer = window.setInterval(
          () => this.send({ t: 'ping', ts: performance.now() }),
          2000,
        );
        resolve();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.t === 'pong') this.rttMs = performance.now() - msg.ts;
        this.handlers.onMessage(msg);
      };
      ws.onerror = () => {
        if (!opened) reject(new Error('Could not connect to the server'));
      };
      ws.onclose = (ev) => {
        if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
        this.pingTimer = null;
        this.handlers.onClose({ code: ev.code, reason: ev.reason, wasOpen: opened });
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close(1000, 'bye');
  }
}
