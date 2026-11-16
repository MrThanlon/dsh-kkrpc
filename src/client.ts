import { type Context, Service } from "@deepseek-ai/cordis";
import {
  RPCChannel,
  Remote,
  proxy,
  releaseProxy,
  wrap,
} from "@mrthanlon/kkrpc/remote-refs";
import { webSocketTransport } from "@mrthanlon/kkrpc/ws";
import { ROUTE_PATH, type Promisify } from "./shared";
export { proxy, releaseProxy, type Promisify };

declare module "@deepseek-ai/cordis" {
  interface Context {
    kkrpc: Remote<Context>;
  }
}

function resolveWebSocketUrl(): string {
  const { protocol, host } = window.location;
  if (protocol === "http:" || protocol === "https:") {
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${host}${ROUTE_PATH}`;
  }

  const streamBase = (globalThis as Record<string, any>).__DSH_TRANSPORT__
    ?.streamBaseUrl;
  if (streamBase) {
    const url = new URL(ROUTE_PATH, streamBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
  }

  return `ws://127.0.0.1:3080${ROUTE_PATH}`;
}

export interface KkRPCClientConfig {
  socket: WebSocket;
}

export default function apply(ctx: Context) {
  ctx.effect(() => {
    let socket: WebSocket | null = null;
    let serviceFork: { dispose(): void } | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const url = resolveWebSocketUrl();
      const ws = new WebSocket(url);
      socket = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        serviceFork = {
          dispose: ctx.provide("kkrpc", wrap(webSocketTransport(ws))),
        };
      };

      ws.onclose = () => {
        if (serviceFork) {
          serviceFork.dispose();
          serviceFork = null;
        }
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (serviceFork) {
        serviceFork.dispose();
        serviceFork = null;
      }
      if (socket) {
        socket.close();
      }
    };
  });

  ctx.inject(["kkrpc"], (ctx) => {
    console.log("start listen");
    ctx.kkrpc.on("kkrpc/custom", (n: number) => {
      console.log("host:", n);
    });
  });
}
