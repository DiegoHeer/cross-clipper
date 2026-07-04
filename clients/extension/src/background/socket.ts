import type { SocketFactory, WsLike } from "@crossclipper/core";

export function wsUrl(baseUrl: string, token: string): string {
  const ws = baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${ws}/api/v1/ws?token=${encodeURIComponent(token)}`;
}

export const browserSocketFactory: SocketFactory = (url: string): WsLike => {
  const ws = new WebSocket(url);
  const like: WsLike = {
    send: (d) => ws.send(d),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  ws.onopen = () => like.onopen?.();
  ws.onmessage = (ev) => like.onmessage?.(String(ev.data));
  ws.onclose = () => like.onclose?.();
  return like;
};
