// Checks the package rules of README "Contributing" that a machine can check.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");
const pkg = JSON.parse(read("package.json"));
const srcFiles = readdirSync(join(root, "src")).filter((f) =>
  f.endsWith(".js"),
);

test("package.json has no dependency fields", () => {
  for (const key of [
    "dependencies",
    "peerDependencies",
    "peerDependenciesMeta",
    "optionalDependencies",
    "devDependencies",
  ]) {
    assert.equal(key in pkg, false, `package.json has "${key}"`);
  }
  assert.deepEqual(pkg.files, ["src/", "README.md"]);
  assert.equal(pkg.version, VERSION);
});

test("src imports only relative paths and node: built-ins", () => {
  const specs = srcFiles.flatMap((f) =>
    [
      ...read(`src/${f}`).matchAll(
        /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
      ),
    ].map((m) => m[1]),
  );
  assert.ok(specs.includes("node:crypto"));
  assert.ok(specs.includes("./otel-context.js"));
  const bad = specs.filter(
    (s) => !s.startsWith("./") && !s.startsWith("node:"),
  );
  assert.deepEqual(bad, []);
});

test("src/index.d.ts imports only the lite SDK's types", () => {
  const specs = [
    ...read("src/index.d.ts").matchAll(/\bfrom\s*["']([^"']+)["']/g),
  ].map((m) => m[1]);
  assert.deepEqual(specs, [
    "../../aws-durable-execution-sdk-js-lite/src/index.js",
  ]);
});

test("src does not use async_hooks", () => {
  for (const f of srcFiles) {
    assert.doesNotMatch(read(`src/${f}`), /async_hooks|AsyncLocalStorage/, f);
  }
});
