// Checks the package rules that a machine can check.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const pkg = JSON.parse(read("package.json"));
const srcFiles = readdirSync(join(root, "src"), { recursive: true })
  .filter((f) => f.endsWith(".js"))
  .map((f) => join("src", f));

// Every module specifier of import, export-from and dynamic import().
const specifiers = (text) =>
  [
    ...text.matchAll(
      /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
    ),
    ...text.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
    ...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
  ].map((m) => m[1]);

test("package.json has no dependencies of any kind", () => {
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.files, ["src/", "README.md"]);
  for (const key of Object.keys(pkg)) {
    assert.doesNotMatch(key, /dependencies/i, key);
  }
});

test("src imports only relative paths and node: built-ins", () => {
  const found = [];
  for (const file of srcFiles) {
    for (const spec of specifiers(read(file))) {
      found.push(spec);
      assert.match(spec, /^(\.\.?\/|node:)/, `${file} imports ${spec}`);
    }
  }
  // The patterns must find imports that exist. Otherwise this test checks nothing.
  assert.ok(found.includes("node:crypto"));
  assert.ok(found.includes("../aws.js"));
  assert.ok(found.includes("./record.js"));
});

test("src never imports node:async_hooks or the lite SDK", () => {
  for (const file of srcFiles) {
    const text = read(file);
    assert.equal(text.includes("async_hooks"), false, file);
    assert.equal(text.includes("durable-execution-sdk-js-lite/"), false, file);
  }
});

test("every export has types", () => {
  for (const entry of Object.values(pkg.exports)) {
    assert.ok(entry.types.endsWith(".d.ts"));
    assert.ok(read(entry.types).length > 0);
    assert.ok(read(entry.default).length > 0);
  }
});
