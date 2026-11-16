import { createHttpHandler, httpClientTransport } from "@mrthanlon/kkrpc/http";
import { wrap } from "@mrthanlon/kkrpc";

const httpAPI = {
  foo() {
    return "done";
  },
};
const handler = createHttpHandler(httpAPI);
const client = wrap<typeof httpAPI>(
  httpClientTransport({
    url: "",
    fetch: (input, init) => handler(new Request(input, init)),
  }),
);
