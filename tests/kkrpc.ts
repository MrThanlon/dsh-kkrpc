import {
  expose,
  PromisifyReturn,
  Transport,
  wrap,
} from "@mrthanlon/kkrpc/remote-refs";
import {
  webSocketClientTransport,
  webSocketTransport,
} from "@mrthanlon/kkrpc/ws";
import { WebSocketServer } from "ws";
import { Context, Events } from "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface Events {
    "foo"(n: number): void;
  }
}

const wss = new WebSocketServer({ port: 0 });
wss.on("connection", (ws) => {
  const ctx = new Context();
  expose(ctx as any, webSocketTransport(ws));
  setInterval(() => {
    ctx.emit("foo", 222);
  }, 1000);
});
wss.on("listening", async () => {
  const address = wss.address();
  const port = (address as { port: number }).port;
  const ctx = wrap<Context>(
    webSocketClientTransport({ url: `ws://localhost:${port}` }),
  );

  const dispose = await ctx.on("foo", (n: number) => {
    console.log("foo", n);
    setTimeout(() => {
      dispose();
      setTimeout(() => process.exit(0), 3000);
    }, 5000);
  });
  console.log(dispose);
});
