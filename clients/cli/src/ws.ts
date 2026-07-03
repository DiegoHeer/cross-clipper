import WebSocket from "ws";

import type { SocketFactory, WsLike } from "@crossclipper/core";

export const nodeSocketFactory: SocketFactory = (url: string): WsLike => {
  const sock = new WebSocket(url);
  const like: WsLike = {
    send: (data) => sock.send(data),
    close: () => sock.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  sock.on("open", () => like.onopen?.());
  sock.on("message", (data) => like.onmessage?.(data.toString()));
  sock.on("close", () => like.onclose?.());
  sock.on("error", () => { /* close event follows; reconnect handles it */ });
  return like;
};
