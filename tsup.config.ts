import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "cli/install": "src/cli/install.ts" },
    format: "esm",
    target: "node20",
    outDir: "dist",
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
  },
  {
    entry: { "plugin/index": "src/plugin/index.ts" },
    format: "esm",
    target: "node20",
    outDir: "dist",
    dts: true,
    sourcemap: true,
  },
]);
