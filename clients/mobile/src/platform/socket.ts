import type { SocketFactory, WsLike } from "@crossclipper/core";

type WsCtor = new (url: string) => Pick<WebSocket, "send" | "close" | "onopen" | "onmessage" | "onclose">;

/**
 * Converts an http(s) base URL and a bearer token into a WebSocket URL
 * pointing at the CrossClipper server's WS endpoint.
 *
 * Identical to the extension's wsUrl helper — keep in sync if protocol changes.
 */
export function wsUrl(baseUrl: string, token: string): string {
  const ws = baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${ws}/api/v1/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Returns a SocketFactory that wraps a given WebSocket constructor into a WsLike.
 * The constructor is injectable for testing (defaults to the global WebSocket).
 *
 * RN's WebSocket API is spec-compatible with browser WebSocket, so the adapter
 * is structurally identical to the extension's browserSocketFactory.
 * ev.data is coerced to string via String() to satisfy WsLike.onmessage.
 */
export function makeRnSocketFactory(WS: WsCtor = WebSocket): SocketFactory {
  return (url: string): WsLike => {
    const ws = new WS(url);
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
}

/**
 * Default RN SocketFactory — uses the global WebSocket (available in React Native).
 * Pass as socketFactory to SyncEngine or SyncController.
 */
export const rnSocketFactory: SocketFactory = makeRnSocketFactory();
