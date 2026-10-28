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

// Release builds on the Mac mini sign with Developer ID and notarize (docs/desktop-signing.md).
// Without HERMES_MAC_SIGN_IDENTITY (Linux, local builds) the package stays unsigned.
const identity = process.env.HERMES_MAC_SIGN_IDENTITY;
const keychain = process.env.HERMES_MAC_SIGN_KEYCHAIN || undefined;
const notaryProfile = process.env.HERMES_MAC_NOTARY_PROFILE;
if (notaryProfile && !identity) {
  throw new Error("HERMES_MAC_NOTARY_PROFILE needs HERMES_MAC_SIGN_IDENTITY");
}
// @electron/osx-sign defaults: hardened runtime, and Electron's entitlements for the
// app and each helper (JIT; camera and microphone for pages in the built-in browser).
const signing = identity
  ? {
      osxSign: { identity, keychain, preAutoEntitlements: false },
      ...(notaryProfile ? { osxNotarize: { keychainProfile: notaryProfile, keychain } } : {}),
    }
  : {};

const paths = await packager({
  ...signing,
  dir: staging,
  out: artifacts,
  name: "Hermes",
  platform: "darwin",
  arch: "arm64",
  electronVersion: desktopPackage.devDependencies.electron,
  overwrite: true,
  asar: true,
  prune: true,
  icon: resolve(root, "resources/icon.icns"),
  appBundleId: "com.changx.hermes.desktop",
  appVersion: desktopPackage.version,
  buildVersion: "1",
  extendInfo: {
    LSMinimumSystemVersion: "12.0",
    CFBundleURLTypes: [{ CFBundleURLName: "Hermes session", CFBundleURLSchemes: ["hermesapp"] }],
    // Shown when a page in the built-in browser asks for the camera or microphone.
    NSCameraUsageDescription: "A website in the Hermes browser wants to use the camera.",
    NSMicrophoneUsageDescription: "A website in the Hermes browser wants to use the microphone.",
  },
});

await rm(staging, { recursive: true, force: true });
if (paths.length !== 1) {
  throw new Error(`Expected one packaged app, received ${paths.length}`);
}
console.log(`Packaged ${identity ? (notaryProfile ? "signed and notarized" : "signed") : "unsigned"} macOS arm64 app at ${paths[0]}`);
