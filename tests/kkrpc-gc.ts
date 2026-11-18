import { Context } from "@deepseek-ai/cordis";
import { RPCChannel, wrap } from "@mrthanlon/kkrpc/remote-refs";
import { createPair } from "./common";

export type CustomEvent = () => Promise<{
  n: number;
  t: number;
  payload: Uint8Array;
}>;

declare module "@deepseek-ai/cordis" {
  interface Events {
    "kkrpc/custom"(fn: CustomEvent): void;
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

async function main() {
  if (typeof global.gc !== "function") {
    console.warn(
      "Notice: Please run with node --expose-gc (or tsx --expose-gc) to trigger manual GC",
    );
  }

  const [hostTransport, clientTransport] = createPair();
  const hostCtx = new Context();

  const hostChannel = new RPCChannel(hostTransport, {
    expose: hostCtx,
    timeout: 0,
  });
  const clientCtx = wrap<Context>(clientTransport, { timeout: 0 });

  let hostClosureCreated = 0;
  let hostClosureCollected = 0;
  let clientProxyReceived = 0;
  let clientProxyCollected = 0;

  const hostRegistry = new FinalizationRegistry(() => {
    hostClosureCollected += 1;
  });

  const clientRegistry = new FinalizationRegistry(() => {
    clientProxyCollected += 1;
  });

  await clientCtx.on("kkrpc/custom", async (fn: CustomEvent) => {
    clientProxyReceived += 1;
    clientRegistry.register(fn, clientProxyReceived);
    await fn();
  });

  const TOTAL_ITERATIONS = 2000;
  global.gc?.();
  const memBefore = process.memoryUsage().heapUsed;

  console.log(
    `Starting continuous transmission of ${TOTAL_ITERATIONS} closure functions...`,
  );

  function sendBatch() {
    for (let n = 1; n <= TOTAL_ITERATIONS; n++) {
      // Simulate 64KB captured payload per closure to amplify memory footprint observation
      const payload = new Uint8Array(64 * 1024);
      payload[0] = n & 0xff;
      const closure: CustomEvent = () =>
        Promise.resolve({ n, t: Date.now(), payload });
      hostClosureCreated += 1;
      hostRegistry.register(closure, n);

      hostCtx.emit("kkrpc/custom", closure);
    }
  }

  sendBatch();

  // Wait for all async calls and message delivery to settle
  await sleep(500);

  const memBeforeGC = process.memoryUsage().heapUsed;

  // Trigger repeated GC cycles and wait for FinalizationRegistry cleanup microtasks
  for (let i = 0; i < 15; i++) {
    global.gc?.();
    await sleep(50);
  }

  const memAfter = process.memoryUsage().heapUsed;
  const hostLocalRefsSize = (hostChannel as any).localRefs?.size;

  console.log("\n=== GC & Memory Leak Detection Results ===");
  console.log({
    hostClosureCreated,
    hostClosureCollected,
    hostLocalRefsSize,
    clientProxyReceived,
    clientProxyCollected,
    heapUsedBefore: formatMB(memBefore),
    heapUsedBeforeGC: formatMB(memBeforeGC),
    heapUsedAfterGC: formatMB(memAfter),
    heapUsedNetGrowth: formatMB(memAfter - memBefore),
  });

  if (hostClosureCollected < hostClosureCreated) {
    console.error(
      `❌ Memory leak detected: Only ${hostClosureCollected} out of ${hostClosureCreated} closures on host were collected by GC (remaining localRefs: ${hostLocalRefsSize})`,
    );
  } else {
    console.log(
      "✅ No memory leak detected: All closures and remote proxies were collected by GC",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
