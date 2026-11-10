import { expose, proxy, wrap } from "kkrpc/remote-refs";
import { webSocketClientTransport, webSocketTransport } from "kkrpc/ws";
import { WebSocketServer } from "ws";

const api = {
  async closure() {
    return proxy(() => 114514);
  },
  asyncIterator: async function* () {
    yield 1919810;
  },
  async callback(cb: () => Promise<number>) {
    const n = await cb();
    console.log("host:", n);
    return n;
  },
};
type API = typeof api;

const wss = new WebSocketServer({ port: 0 });
wss.on("connection", (ws) => {
  expose(api, webSocketTransport(ws));
});
wss.on("listening", async () => {
  const address = wss.address();
  const port = (address as { port: number }).port;
  const api = wrap<API>(
    webSocketClientTransport({ url: `ws://localhost:${port}` }),
  );
  const cb = await api.closure();
  // cb is actually undefined, expected () => number
  console.log("expect", cb, "to be [Function: cb]");

  // const iter = await api.asyncIterator();
  // // iter is actually {}, expected AsyncGenerator<number, void, unknown>
  // console.log("expect", iter, "to be Object [AsyncGenerator] {}");

  const result = await api.callback(proxy(() => Promise.resolve(321)));
  console.log("client:", result);
  process.exit(0);
});
