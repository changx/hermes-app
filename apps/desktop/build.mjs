import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");
const katexDist = resolve(dirname(createRequire(import.meta.url).resolve("katex/package.json")), "dist");

await rm(dist, { recursive: true, force: true });
await Promise.all([
  mkdir(resolve(dist, "main"), { recursive: true }),
  mkdir(resolve(dist, "preload"), { recursive: true }),
  mkdir(resolve(dist, "renderer/fonts"), { recursive: true }),
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
    // Isolated-world page reader for the built-in browser; exposes nothing to pages.
    entryPoints: [resolve(root, "src/preload/browser-page.ts")],
    outfile: resolve(dist, "preload/browser-page.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  }),
  build({
    // Markdown attachment preview page; served by the hermes-preview: protocol.
    entryPoints: [resolve(root, "src/preview/markdown.tsx")],
    outfile: resolve(dist, "renderer/markdown-preview.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome132",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
  }),
  build({
    // Sidebar Session card window: a static page main fills with text (no preload, no React).
    entryPoints: [resolve(root, "src/card/session-card.ts")],
    outfile: resolve(dist, "renderer/session-card.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome132",
    minify: true,
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
  copyFile(resolve(root, "../../assets/work-icons.ttf"), resolve(dist, "renderer/work-icons.ttf")),
  copyFile(resolve(root, "src/renderer/styles.css"), resolve(dist, "renderer/styles.css")),
  copyFile(resolve(root, "src/card/session-card.html"), resolve(dist, "renderer/session-card.html")),
  copyFile(resolve(root, "src/card/session-card.css"), resolve(dist, "renderer/session-card.css")),
  // KaTeX layout for formulas in replies and Markdown previews. Chromium uses the woff2 fonts.
  copyFile(resolve(katexDist, "katex.min.css"), resolve(dist, "renderer/katex.css")),
  ...(await readdir(resolve(katexDist, "fonts"))).filter(name => name.endsWith(".woff2"))
    .map(name => copyFile(resolve(katexDist, "fonts", name), resolve(dist, "renderer/fonts", name))),
]);

console.log("Built desktop main, preload, and renderer into apps/desktop/dist");
