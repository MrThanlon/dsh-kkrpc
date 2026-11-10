import { Context, Service } from "@deepseek-ai/cordis";
import { RPCChannel, wrap } from "kkrpc";
import { webSocketTransport } from "kkrpc/ws";
import { ROUTE_PATH, type Promisify, type IKkRPCService } from "./shared.js";
import type { TestService } from "./index.js";

export { type Promisify, type IKkRPCService };

declare module "@deepseek-ai/cordis" {
  interface Context {
    kkrpc: IKkRPCService;
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

export class KkRPCService extends Service implements IKkRPCService {
  static provide = "kkrpc";

  readonly localAPI: Record<string, any> = {};
  readonly channel: RPCChannel;

  constructor(ctx: Context, config: KkRPCClientConfig) {
    super(ctx, "kkrpc");
    const transport = webSocketTransport(config.socket);
    this.channel = new RPCChannel(transport, { expose: this.localAPI });
  }

  getAPI<T extends Record<string, any> = Record<string, any>>(
    namespace: string,
  ): Promisify<T> {
    const remote = this.channel.getAPI() as Record<string, any>;
    return remote[namespace] as Promisify<T>;
  }

  exposeAPI<T extends Record<string, any>>(
    namespace: string,
    api: T,
  ): () => void {
    return this.ctx.effect(() => {
      this.localAPI[namespace] = api;
      return () => {
        delete this.localAPI[namespace];
      };
    });
  }
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
        serviceFork = ctx.plugin(KkRPCService, { socket: ws });
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

  // 客户端测试插件
  ctx.plugin({
    inject: ["kkrpc"],
    async apply(ctx) {
      try {
        console.log("kkrpc client test plugin applied");
        const client = ctx.kkrpc.getAPI<TestService>("test");
        console.log(await client.greeting("World"));
        console.log("start callback test");
        const result = await client.callback((msg) => {
          console.log("Callback received:", msg);
        });
        console.log("callback called", result);
        console.log("callback finished");
      } catch (error) {
        console.error(error);
      }
    },
  });
}
