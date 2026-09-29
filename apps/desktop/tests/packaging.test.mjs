import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../package.mjs", import.meta.url), "utf8");
const desktopPackage = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const rootPackage = JSON.parse(
  await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
);
const gitignore = await readFile(new URL("../../../.gitignore", import.meta.url), "utf8");

test("mac package target is an unsigned isolated arm64 app", () => {
  assert.equal(desktopPackage.scripts["package:mac"], "npm run build && node package.mjs");
  assert.equal(rootPackage.scripts["desktop:package:mac"], "npm run package:mac --workspace @hermes-app/desktop");
  assert.match(source, /platform: "darwin"/);
  assert.match(source, /arch: "arm64"/);
  assert.match(source, /name: "Hermes"/);
  assert.match(source, /appBundleId: "com\.changx\.hermes\.desktop"/);
  assert.match(source, /LSMinimumSystemVersion: "12\.0"/);
  assert.match(source, /asar: true/);
});

test("packaging stages only built runtime files", () => {
  assert.match(source, /await cp\(dist, resolve\(staging, "dist"\)/);
  assert.match(source, /filter: \(source\) => !source\.endsWith\("\.map"\)/);
  assert.match(source, /main: "dist\/main\/index\.cjs"/);
  assert.doesNotMatch(source, /node_modules|src\/|tests\/|docs\/|\.env/);
  assert.match(gitignore, /^apps\/desktop\/\.package-staging\/$/m);
  assert.match(gitignore, /^apps\/desktop\/artifacts\/$/m);
});
