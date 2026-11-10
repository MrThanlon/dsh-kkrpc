import { Context, Service } from "@deepseek-ai/cordis";
import type { WebUpgradeRoute } from "@deepseek-ai/dsh-host-webserver";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createHash, randomBytes } from "node:crypto";
import { RPCChannel, type Transport, type RPCMessage } from "kkrpc";
import { ROUTE_PATH, KKRPC_ORIGIN_KEY, type Promisify, type IKkRPCService } from "./shared";

export { type Promisify, type IKkRPCService };
export const inject = ["webServer"];

declare module "@deepseek-ai/cordis" {
  interface Context {
    kkrpc: IKkRPCService;
  }
}

function parseFrame(
  buffer: Buffer,
): { payload: string; bytesRead: number } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const isMasked = (buffer[1] & 0x80) === 0x80;
  let len = buffer[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buffer.length < 4) return null;
    len = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buffer.length < 10) return null;
    len = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  if (isMasked) offset += 4;
  if (buffer.length < offset + len) return null;

  if (opcode === 1) {
    const payload = Buffer.alloc(len);
    if (isMasked) {
      const mask = buffer.subarray(offset - 4, offset);
      for (let i = 0; i < len; i++) {
        payload[i] = buffer[offset + i] ^ mask[i % 4];
      }
    } else {
      buffer.copy(payload, 0, offset, offset + len);
    }
    return { payload: payload.toString("utf8"), bytesRead: offset + len };
  }

  return { payload: "", bytesRead: offset + len };
}

function encodeFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function createServerTransport(socket: Duplex): Transport<RPCMessage> {
  const listeners = new Set<(msg: RPCMessage) => void>();
  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const frame = parseFrame(buffer);
      if (!frame) break;
      buffer = buffer.subarray(frame.bytesRead);
      if (frame.payload) {
        try {
          const msg = JSON.parse(frame.payload);
          for (const fn of listeners) fn(msg);
        } catch {}
      }
    }
  });

  return {
    send(message: RPCMessage) {
      socket.write(encodeFrame(JSON.stringify(message)));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      socket.destroy();
    },
  };
}

const testService = {
  greeting(name: string) {
    return `Hello, ${name}!`;
  },
};
export type TestService = typeof testService;

export default class KkRPCService extends Service {
  static provide = "kkrpc";
  static inject = ["webServer"];

  readonly localAPI: Record<string, any> = {};
  channel: RPCChannel | null = null;
  private readonly token = randomBytes(16).toString("hex");
  private channelResolvers = new Set<(channel: RPCChannel) => void>();

  constructor(ctx: Context) {
    super(ctx, "kkrpc");

    const route: WebUpgradeRoute = {
      path: ROUTE_PATH,
      handler: (req: IncomingMessage, socket: Duplex) => {
        const reqUrl = new URL(req.url ?? "", "http://127.0.0.1");
        if (reqUrl.searchParams.get("token") !== this.token) {
          socket.destroy();
          return;
        }

        const key = req.headers["sec-websocket-key"];
        if (!key) {
          socket.destroy();
          return;
        }

        const accept = createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");

        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );

        const transport = createServerTransport(socket);
        const channel = new RPCChannel(transport, { expose: this.localAPI });
        this.channel = channel;
        for (const resolve of this.channelResolvers) resolve(channel);
        this.channelResolvers.clear();

        socket.once("close", () => {
          if (this.channel === channel) {
            this.channel = null;
          }
        });
      },
    };

    ctx.on("webserver/index-inject", (table) => {
      table.push({
        kind: "global",
        name: KKRPC_ORIGIN_KEY,
        value: `${ctx.webServer.getOrigin()}?token=${this.token}`,
      });
    });

    ctx.effect(() => {
      const unregisterUpgrade = ctx.webServer.registerUpgrade(route);
      return () => {
        unregisterUpgrade();
        this.channel = null;
      };
    });

    ctx.plugin({
      inject: ["kkrpc"],
      apply(ctx) {
        console.log("kkrpc host test plugin applied");
        ctx.kkrpc.exposeAPI("test", testService);
      },
    });
  }

  private whenConnected(): Promise<RPCChannel> {
    if (this.channel) return Promise.resolve(this.channel);
    return new Promise<RPCChannel>((resolve) => {
      this.channelResolvers.add(resolve);
    });
  }

  async getAPI<T extends Record<string, any> = Record<string, any>>(
    namespace: string,
  ): Promise<Promisify<T>> {
    const channel = await this.whenConnected();
    const remote = channel.getAPI() as Record<string, any>;
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
