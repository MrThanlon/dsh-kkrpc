# AGENTS.md

Welcome to **dsh-kkrpc**. This guide documents the architecture, conventions, and operational workflows for AI agents and human developers contributing to this codebase.

---

## 1. Project Overview

`dsh-kkrpc` is an official DeepSeek Harness (DSH) bridge plugin providing seamless, type-safe, bidirectional RPC communication between Host and Client runtimes powered by [@mrthanlon/kkrpc](https://github.com/MrThanlon/kkrpc) (`kkrpc/remote-refs`).

- **Plugin Name**: `dsh-kkrpc`
- **Cordis Service**: `kkrpc` (accessible via `ctx.kkrpc`, typed as `Remote<Context>`)
- **Default WebSocket Endpoint**: `/dsh-kkrpc`
- **Architecture**: Directly exposes the Cordis `Context` across the wire with remote-reference support, allowing clients to invoke host services, listen to events, and pass callbacks with automatic garbage collection.

---

## 2. Core Architecture

### 2.1 Host Side (`src/index.ts`)
- Extends Cordis `Service` and declares `static inject = ['webServer']`.
- Registers a WebSocket HTTP upgrade route on `ctx.webServer.registerUpgrade` at `/dsh-kkrpc`.
- Implements RFC 6455 framing and unmasking over raw TCP `Duplex` streams without external Node `ws` dependencies.
- Advertises `capabilities: { remoteRefs: true }` on its transport.
- Directly exposes `ctx` to the connecting client via `new RPCChannel(transport, { expose: ctx, timeout: 0 })`.

### 2.2 Client Side (`src/client.ts`)
- **Dynamic Service Lifecycle**:
  - The default export is a standard plugin function `apply(ctx: Context)`.
  - Establishes and monitors the WebSocket connection.
  - On `ws.onopen`, mounts the remote context proxy via `ctx.provide('kkrpc', wrap(webSocketTransport(ws), { timeout: 0 }))`.
  - When the socket disconnects, disposes the service fork and reconnects with exponential/fixed backoff.
- **Smart URL Resolution (`resolveWebSocketUrl`)**:
  - **Web / Reverse Proxy**: If `window.location.protocol` is `http:` or `https:`, prioritizes `window.location.host` to ensure seamless operation through reverse proxies.
  - **Electron Desktop**: If running under `dsh-app://app/` or non-HTTP protocols, directly uses DSH's desktop transport origin from `globalThis.__DSH_TRANSPORT__.streamBaseUrl`.

### 2.3 Automatic Garbage Collection & Remote References
- Uses `@mrthanlon/kkrpc/remote-refs` with `FinalizationRegistry` integration.
- When callbacks or closures are passed over the bridge, the receiving end creates a remote reference facade.
- Once the receiver finishes using the callback and the proxy is garbage collected by V8, the receiver automatically notifies the sender via `['ref', id, 'release']`, releasing the closure from the sender's memory without manual cleanup calls.

---

## 3. Directory Layout

```
dsh-kkrpc/
├── package.json          # Package manifest with exports, scripts, dependencies
├── tsconfig.json         # TypeScript configuration (strict, bundler, outDir: lib)
├── tsdown.config.ts      # tsdown multi-entry bundler configuration
├── cordis.patch.yml      # DSH plugin manager patch declaration
├── .gitignore            # Git ignore rules
├── AGENTS.md             # Developer and agent guide
├── src/
│   ├── index.ts          # Host runtime entry (KkRPCService)
│   ├── client.ts         # Client runtime entry (apply + dynamic service provider)
│   └── shared.ts         # Shared constants and utility types
├── lib/                  # Compiled output (built by tsc & tsdown)
│   ├── index.js          # Host ESM bundle
│   ├── index.d.ts        # Host TypeScript declaration
│   ├── client.js         # Client CJS bundle (wrapped with __ModuleLoader__)
│   ├── client.d.ts       # Client TypeScript declaration
│   └── shared.d.ts       # Shared TypeScript declaration
└── locale/
    ├── en.json           # English metadata
    └── zh.json           # Chinese metadata
```

---

## 4. Development & Build Workflows

```bash
# Build declarations with tsc and bundles with tsdown into lib/
pnpm run build

# Run type checking without emitting files
pnpm run typecheck

# Run memory leak and GC verification test
pnpm exec tsx --expose-gc tests/kkrpc-gc.ts
```

---

## 5. Usage Example

### In Client Plugin
```ts
import type { Context } from '@deepseek-ai/cordis';

export const inject = ['kkrpc'];

export function apply(ctx: Context) {
  // Listen to events emitted by the Host Context
  ctx.kkrpc.on('some-event', (data) => {
    console.log('Received from host:', data);
  });

  // Call Host services directly
  void (async () => {
    const status = await ctx.kkrpc.webServer.status();
    console.log('Host webServer status:', status);
  })();
}
```

---

## 6. Critical Rules for AI Agents

1. **Client Inlining**: Client bundles run in browser contexts where npm dependencies do not exist. `@mrthanlon/kkrpc` must always be bundled inline (`alwaysBundle: [/^@mrthanlon\/kkrpc/]`). Never allow `require('@mrthanlon/kkrpc')` in emitted `lib/client.js`.
2. **Client Loader Wrapping**: Do not write `window.__ModuleLoader__.load` boilerplate in `src/client.ts`. The wrapper is injected by `tsdown.config.ts` via `outputOptions.banner/footer/intro`.
3. **No Defensive `?.` Overuse**: Avoid unnecessary optional chaining on injected services.
4. **Cordis Augmentation**: Extend `Context` with `kkrpc: Remote<Context>` in client declarations.
