import type { WsLike } from "../src/sync/socket";

export class FakeSocket implements WsLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }

  // test-side controls
  serverOpen(): void {
    this.onopen?.();
  }

  serverSend(event: object): void {
    this.onmessage?.(JSON.stringify(event));
  }

  serverDrop(): void {
    this.onclose?.();
  }
}

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
