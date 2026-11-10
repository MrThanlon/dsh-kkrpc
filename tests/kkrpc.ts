import { wrap } from "kkrpc";
import { expose } from "kkrpc";
import { webSocketTransport, webSocketClientTransport } from "kkrpc/ws";
import { WebSocketServer } from "ws";

const api = {
  add(a: number, b: number, callback?: (result: number) => void) {
    callback?.(a + b);
    return a + b;
  },
};
type API = typeof api;

const wss = new WebSocketServer({ port: 0 });
wss.on("connection", (ws) => {
  expose(api, webSocketTransport(ws));
});
wss.on("listening", async () => {
  const address = wss.address();
  console.log(address);
});
