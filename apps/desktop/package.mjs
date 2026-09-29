import { packager } from "@electron/packager";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");
const staging = resolve(root, ".package-staging");
const artifacts = resolve(root, "artifacts");
const desktopPackage = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

await rm(staging, { recursive: true, force: true });
await rm(artifacts, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(dist, resolve(staging, "dist"), {
  recursive: true,
  filter: (source) => !source.endsWith(".map"),
});
await writeFile(
  resolve(staging, "package.json"),
  `${JSON.stringify(
    {
      name: "hermes-desktop",
      productName: "Hermes",
      version: desktopPackage.version,
      private: true,
      main: "dist/main/index.cjs",
    },
    null,
    2,
  )}\n`,
);

const paths = await packager({
  dir: staging,
  out: artifacts,
  name: "Hermes",
  platform: "darwin",
  arch: "arm64",
  electronVersion: desktopPackage.devDependencies.electron,
  overwrite: true,
  asar: true,
  prune: true,
  appBundleId: "com.changx.hermes.desktop",
  appVersion: desktopPackage.version,
  buildVersion: "1",
  extendInfo: {
    LSMinimumSystemVersion: "12.0",
  },
});

await rm(staging, { recursive: true, force: true });
if (paths.length !== 1) {
  throw new Error(`Expected one packaged app, received ${paths.length}`);
}
console.log(`Packaged unsigned macOS arm64 app at ${paths[0]}`);
