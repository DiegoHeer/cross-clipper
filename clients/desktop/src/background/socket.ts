import type { SocketFactory, WsLike } from "@crossclipper/core";

/**
 * Converts an http(s) base URL + token into the WebSocket endpoint URL.
 * Example: "http://server" → "ws://server/api/v1/ws?token=<token>"
 */
export function wsUrl(baseUrl: string, token: string): string {
  const ws = baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${ws}/api/v1/ws?token=${encodeURIComponent(token)}`;
}

/**
 * SocketFactory for the Tauri desktop background window.
 * WebView2 exposes a browser-standard WebSocket global, so we use it directly.
 */
export const tauriSocketFactory: SocketFactory = (url: string): WsLike => {
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
