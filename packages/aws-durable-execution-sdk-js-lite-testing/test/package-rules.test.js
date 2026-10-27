// Checks the package rules of README "Contributing" that a machine can check.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
});

// Static imports, side-effect imports, export-from and dynamic import(), as in the lite
// SDK's rules test. Anchoring on import/export keeps a comment such as `from "x"` out.
const SPECIFIER_PATTERNS = [
  /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^\s*import\s*["']([^"']+)["']/gm,
  /\bimport\s*\(\s*["']([^"']+)["']/g,
];
const specifiers = (text) =>
  SPECIFIER_PATTERNS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1]));

// The package receives the handler from createHandler. So src never imports the lite SDK.
test("src imports only relative paths and node: built-ins", () => {
  const specs = srcFiles.flatMap((f) => specifiers(read(`src/${f}`)));
  assert.ok(specs.includes("./in-memory-service.js"));
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

test("src has no TypeScript sources except index.d.ts", () => {
  const bad = readdirSync(join(root, "src")).filter(
    (f) => /\.[cm]?tsx?$/.test(f) && f !== "index.d.ts",
  );
  assert.deepEqual(bad, []);
});

// require(esm) fails for a module graph that uses top-level await. So a successful
// require() shows that src has none.
test("CommonJS code can require() the entry point", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof require("../src/index.js").runDurable, "function");
});

test("every public export has a type declaration", async () => {
  const names = Object.keys(await import("../src/index.js"));
  assert.ok(names.length > 0);
  const types = read("src/index.d.ts");
  const missing = names.filter(
    (name) =>
      !new RegExp(
        `\\bexport\\s+(?:declare\\s+)?(?:function|class|const|let|interface|type)\\s+${name}\\b`,
      ).test(types),
  );
  assert.deepEqual(missing, []);
});
