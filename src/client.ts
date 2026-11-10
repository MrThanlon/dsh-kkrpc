import { Context, Service } from '@deepseek-ai/cordis';
import { RPCChannel } from 'kkrpc';
import { webSocketTransport } from 'kkrpc/ws';
import { ROUTE_PATH, KKRPC_ORIGIN_KEY, type Promisify, type IKkRPCService } from './shared.js';
import type { TestService } from './index.js';

export { type Promisify, type IKkRPCService };

declare module '@deepseek-ai/cordis' {
  interface Context {
    kkrpc: IKkRPCService;
  }
}

function resolveWebSocketUrl(): string {
  const globals = globalThis as Record<string, any>;
  const injected = globals[KKRPC_ORIGIN_KEY];

  let token = '';
  if (injected) {
    try {
      const parsed = new URL(injected);
      token = parsed.searchParams.get('token') ?? '';
    } catch {}
  }
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';

  // 1. 优先判断 location 是否为 http/https（标准 Web 环境，优先保证反向代理场景可用）
  const { protocol, host } = window.location;
  if (protocol === 'http:' || protocol === 'https:') {
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${host}${ROUTE_PATH}${tokenQuery}`;
  }

  // 2. location 不是 http/https 时（如 Electron 桌面环境 dsh-app:// 或 file://），走后端注入的 origin
  if (injected) {
    const source = new URL(injected);
    const url = new URL(ROUTE_PATH, source.origin);
    url.search = source.search;
    url.protocol = source.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  }

  const streamBase = globals.__DSH_TRANSPORT__?.streamBaseUrl;
  if (streamBase) {
    const url = new URL(ROUTE_PATH, streamBase);
    if (token) url.searchParams.set('token', token);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  }

  return `ws://127.0.0.1:3080${ROUTE_PATH}${tokenQuery}`;
}

export interface KkRPCClientConfig {
  socket: WebSocket;
}

export class KkRPCService extends Service implements IKkRPCService {
  static provide = 'kkrpc';

  readonly localAPI: Record<string, any> = {};
  readonly channel: RPCChannel;

  constructor(ctx: Context, config: KkRPCClientConfig) {
    super(ctx, 'kkrpc');
    const transport = webSocketTransport(config.socket);
    this.channel = new RPCChannel(transport, { expose: this.localAPI });
  }

  getAPI<T extends Record<string, any> = Record<string, any>>(
    namespace: string,
  ): Promisify<T> {
    const remote = this.channel.getAPI() as Record<string, any>;
    return remote[namespace] as Promisify<T>;
  }

  exposeAPI<T extends Record<string, any>>(namespace: string, api: T): () => void {
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

  // 客户端测试插件：当 kkrpc 注入就绪后触发，直接同步获取 API
  ctx.plugin({
    inject: ['kkrpc'],
    async apply(ctx) {
      console.log('kkrpc client test plugin applied');
      const client = ctx.kkrpc.getAPI<TestService>('test');
      console.log(await client.greeting('World'));
    },
  });
}
