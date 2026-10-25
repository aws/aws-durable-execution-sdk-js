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

test("package.json has only optional peer dependencies", () => {
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.files, ["src/", "README.md"]);
  for (const key of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    assert.equal(key in pkg, false, key);
  }
  assert.deepEqual(Object.keys(pkg.peerDependencies).sort(), [
    "@aws-sdk/client-cloudwatch-logs",
    "@aws-sdk/client-rds-data",
  ]);
  for (const name of Object.keys(pkg.peerDependencies)) {
    assert.equal(pkg.peerDependenciesMeta[name].optional, true);
  }
});

test("each exporter imports only its own client; the core imports no AWS SDK", () => {
  const allowed = {
    "src/exporters/cloudwatch-logs.js": ["@aws-sdk/client-cloudwatch-logs"],
    "src/exporters/aurora.js": ["@aws-sdk/client-rds-data"],
  };
  const found = [];
  for (const file of srcFiles) {
    for (const spec of specifiers(read(file))) {
      found.push(spec);
      if (spec.startsWith("./") || spec.startsWith("../")) continue;
      if (spec === "node:crypto") continue;
      assert.ok(allowed[file]?.includes(spec), `${file} imports ${spec}`);
    }
  }
  // The patterns must find imports that exist. Otherwise this test checks nothing.
  assert.ok(found.includes("@aws-sdk/client-rds-data"));
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
