export interface WsLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
}

export type SocketFactory = (url: string) => WsLike;

export interface ReconnectOptions {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}

export class ReconnectingSocket {
  onOpen: (() => void) | null = null;
  onMessage: ((msg: unknown) => void) | null = null;
  onClose: (() => void) | null = null;

  private sock: WsLike | null = null;
  private stopped = true;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly urlFn: () => string,
    private readonly factory: SocketFactory,
    private readonly opts: ReconnectOptions = {},
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.sock?.close();
    this.sock = null;
  }

  send(data: string): void {
    this.sock?.send(data);
  }

  private connect(): void {
    const sock = this.factory(this.urlFn());
    this.sock = sock;
    sock.onopen = () => {
      this.attempt = 0;
      this.onOpen?.();
    };
    sock.onmessage = (data) => {
      try {
        this.onMessage?.(JSON.parse(data));
      } catch {
        /* ignore malformed frames — WS is only a nudge channel */
      }
    };
    sock.onclose = () => {
      if (this.stopped) return;
      this.onClose?.();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const base = this.opts.baseMs ?? 1000;
    const max = this.opts.maxMs ?? 30000;
    const random = this.opts.random ?? Math.random;
    const delay = Math.min(max, base * 2 ** this.attempt) * (0.5 + random() * 0.5);
    this.attempt++;
    this.timer = setTimeout(() => this.connect(), delay);
  }
}
