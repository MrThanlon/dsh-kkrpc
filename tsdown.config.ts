import { defineConfig } from "tsdown";

const id = "dsh-kkrpc";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    outDir: "lib",
    format: ["esm"],
    platform: "node",
    target: "es2024",
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: ["@deepseek-ai/cordis"],
      alwaysBundle: [/^kkrpc/],
    },
  },
  {
    entry: { client: "src/client.ts" },
    outDir: "lib",
    format: "cjs",
    platform: "neutral",
    target: "es2024",
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: ["@deepseek-ai/cordis"],
      alwaysBundle: [/^kkrpc/],
    },
    outputOptions: {
      entryFileNames: "client.js",
      exports: "named",
      banner: (chunk) =>
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, ${chunk.isEntry ? "" : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
      footer: "return module.exports; } });",
      intro: "var module = { exports: {} }; var exports = module.exports;",
    },
  },
]);
