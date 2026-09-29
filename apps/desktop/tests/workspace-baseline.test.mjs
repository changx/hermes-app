import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const desktopPackage = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const rootPackage = JSON.parse(
  await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
);

test("desktop package is a root workspace with pinned tooling", () => {
  assert.ok(rootPackage.workspaces.includes("apps/desktop"));
  assert.equal(desktopPackage.dependencies["@hermes-app/client"], "0.1.0");
  for (const version of Object.values(desktopPackage.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
  }
});