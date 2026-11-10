import { wrap } from "kkrpc";
import { expose } from "kkrpc";
import { webSocketTransport, webSocketClientTransport } from "kkrpc/ws";
import { WebSocketServer } from "ws";

const api = {
  cb() {
    return () => 114514;
  },
  asyncIterator: async function* () {
    yield 1919810;
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
  const cb = await api.cb();
  // cb is actually undefined, expected () => number
  console.log("expect", cb, "to be [Function: cb]");

  const iter = await api.asyncIterator();
  // iter is actually {}, expected AsyncGenerator<number, void, unknown>
  console.log("expect", iter, "to be Object [AsyncGenerator] {}");
  process.exit(0);
});
