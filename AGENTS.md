# AGENTS.md

Welcome to **dsh-kkrpc**. This guide documents the architecture, conventions, and operational workflows for AI agents and human developers contributing to this codebase.

---

## 1. Project Overview

`dsh-kkrpc` is an official DeepSeek Harness (DSH) bridge plugin providing seamless, type-safe, bidirectional RPC communication between Host and Client runtimes powered by [kkrpc](https://github.com/kunkunsh/kkrpc).

- **Plugin Name**: `dsh-kkrpc`
- **Cordis Service**: `kkrpc` (accessible via `ctx.kkrpc`)
- **Default WebSocket Endpoint**: `/dsh-kkrpc`
- **Type Contract**: Pure TypeScript class pattern, built with `tsdown` and `tsc`.

---

## 2. Core Architecture

### 2.1 Host Side (`src/index.ts`)
- Extends Cordis `Service` and declares `static inject = ['webServer']`.
- Registers a WebSocket HTTP upgrade route on `ctx.webServer.registerUpgrade` at `/dsh-kkrpc`.
- Generates a cryptographically secure random token on startup and verifies connecting clients via query parameters (`?token=...`), preventing unauthorized local process access.
- Injects the authenticated origin into the rendered Web document via the `webserver/index-inject` event (`__DSH_KKRPC_ORIGIN__`).
- Implements RFC 6455 framing and unmasking over raw TCP `Duplex` streams without external Node `ws` dependencies.
- Binds accepted connections to kkrpc's `RPCChannel`.

### 2.2 Client Side (`src/client.ts`)
- **Dynamic Service Lifecycle**:
  - The default export is a standard plugin function `apply(ctx: Context)`.
  - It establishes and monitors the WebSocket connection.
  - `KkRPCService` is **only mounted** upon successful WebSocket connection (`ws.onopen`) via `ctx.plugin(KkRPCService, { socket })`.
  - When the socket disconnects, the service fork is immediately disposed (`dispose()`) and attempts to reconnect. Downstream plugins depending on `inject: ['kkrpc']` are thus automatically suspended and reactivated by Cordis in sync with connection state.
- **Smart URL Resolution (`resolveWebSocketUrl`)**:
  - **Web / Reverse Proxy**: If `window.location.protocol` is `http:` or `https:`, it prioritizes `window.location.host` to ensure seamless operation through Nginx, Caddy, or external domains.
  - **Electron Desktop**: If running under `dsh-app://app/` or non-HTTP protocols, it falls back to the host-injected origin (`__DSH_KKRPC_ORIGIN__`) or desktop transport (`__DSH_TRANSPORT__.streamBaseUrl`).

### 2.3 Service Contract (`src/shared.ts`)
Both Host and Client implement `IKkRPCService`:
- `exposeAPI<T>(namespace: string, api: T): () => void`
  - Mounts methods under an isolated `namespace`.
  - Automatically manages cleanup via `this.ctx.effect`: when the registering plugin unloads, its exposed API is automatically unmounted.
- `getAPI<T>(namespace: string): Promise<Promisify<T>>`
  - Asynchronously resolves once the WebSocket connection is established.
  - Automatically maps remote methods with recursive `Promisify<T>` ensuring type safety.

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
│   ├── client.ts         # Client runtime entry (apply + dynamic KkRPCService)
│   └── shared.ts         # Shared constants and types (Promisify, IKkRPCService)
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

All commands are standard single-line npm/pnpm scripts:

```bash
# Build declarations with tsc and bundles with tsdown into lib/
pnpm run build

# Run type checking without emitting files
pnpm run typecheck
```

---

## 5. Usage Example

### In Host Plugin
```ts
import type { Context } from '@deepseek-ai/cordis';

export const inject = ['kkrpc'];

export function apply(ctx: Context) {
  // Expose methods under a dedicated namespace
  ctx.kkrpc.exposeAPI('myHostService', {
    async querySystemStatus() {
      return { status: 'healthy', timestamp: Date.now() };
    },
  });

  // Call Client methods once connected
  void (async () => {
    const client = await ctx.kkrpc.getAPI('myClientService');
    const result = await client.notifyUser('Hello from Host!');
  })();
}
```

### In Client Plugin
```ts
import type { Context } from '@deepseek-ai/cordis';

export const inject = ['kkrpc'];

export function apply(ctx: Context) {
  // Expose frontend methods (e.g. notifications, UI actions)
  ctx.kkrpc.exposeAPI('myClientService', {
    async notifyUser(message: string) {
      console.log('Received notification:', message);
      return { acknowledged: true };
    },
  });

  // Call Host methods
  void (async () => {
    const host = await ctx.kkrpc.getAPI('myHostService');
    const status = await host.querySystemStatus();
    console.log('Host status:', status);
  })();
}
```

---

## 6. Critical Rules for AI Agents

1. **Client Inlining**: Client bundles run in browser contexts where npm dependencies do not exist. `kkrpc` must always be bundled inline (`alwaysBundle: [/^kkrpc/]`). Never allow `require('kkrpc')` in emitted `lib/client.js`.
2. **Client Loader Wrapping**: Do not write `window.__ModuleLoader__.load` boilerplate in `src/client.ts`. The wrapper is injected by `tsdown.config.ts` via `outputOptions.banner/footer/intro`.
3. **No Defensive `?.` Overuse**: Avoid unnecessary optional chaining on injected services (e.g., `ctx.webServer` is guaranteed when declared in `inject`).
4. **Strict Namespacing**: Always require `namespace: string` on `exposeAPI` and `getAPI`. Do not use optional root APIs.
5. **Cordis Augmentation**: Do not re-augment `webServer` in `@deepseek-ai/cordis`; it is already augmented by `@deepseek-ai/dsh-host-webserver`. Only augment `kkrpc`.
