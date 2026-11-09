import { defineConfig } from "tsdown";

export default defineConfig({
  // One output file per module, as tsc emitted: Convex bundles the component
  // from the files next to dist/component/convex.config.js, and the
  // _generated types are exported by path.
  entry: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/test.ts",
    "!src/**/*.d.ts",
  ],
  unbundle: true,
  // Bundle nothing from node_modules, as tsc did: dev dependencies such as
  // @tanstack/react-start are optional peers of the app.
  deps: { neverBundle: true },
  dts: true,
  fixedExtension: false,
  format: ["esm"],
  platform: "neutral",
  sourcemap: true,
  target: "es2022",
  tsconfig: "tsconfig.build.json",
});
