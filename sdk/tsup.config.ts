import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/x402/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
});
