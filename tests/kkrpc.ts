import {
  expose,
  PromisifyReturn,
  RPCChannel,
  Transport,
  wrap,
} from "@mrthanlon/kkrpc/remote-refs";
import { createPair } from "./common";

const api = {
  callback(cb: () => () => void) {
    const fn = cb();
    return fn;
  },
};
const [a, b] = createPair();
const server = new RPCChannel(a, { expose: api });
const client = wrap<typeof api>(b);

const fn = await client.callback(() => {
  console.log("start");
  return () => {
    console.log("dispose");
  };
});
await fn();
