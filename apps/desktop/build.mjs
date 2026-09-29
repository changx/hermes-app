import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await Promise.all([
  mkdir(resolve(dist, "main"), { recursive: true }),
  mkdir(resolve(dist, "preload"), { recursive: true }),
  mkdir(resolve(dist, "renderer"), { recursive: true }),
]);

await Promise.all([
  build({
    entryPoints: [resolve(root, "src/main/index.ts")],
    outfile: resolve(dist, "main/index.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  }),
  build({
    entryPoints: [resolve(root, "src/preload/index.ts")],
    outfile: resolve(dist, "preload/index.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  }),
  build({
    entryPoints: [resolve(root, "src/renderer/index.tsx")],
    outfile: resolve(dist, "renderer/index.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome132",
    sourcemap: true,
  }),
]);

await Promise.all([
  copyFile(resolve(root, "src/renderer/index.html"), resolve(dist, "renderer/index.html")),
  copyFile(resolve(root, "src/renderer/styles.css"), resolve(dist, "renderer/styles.css")),
]);

console.log("Built desktop main, preload, and renderer into apps/desktop/dist");
