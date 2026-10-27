// Checks the README rules that a machine can check.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "src");
const srcFiles = readdirSync(srcDir, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => join(d.parentPath, d.name));
const read = (file) => readFileSync(file, "utf8");
const pkg = JSON.parse(read(join(root, "package.json")));

// Static imports, side-effect imports, export-from and dynamic import(). [^;] keeps a
// match inside one statement.
const SPECIFIER_PATTERNS = [
  /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^\s*import\s*["']([^"']+)["']/gm,
  /\bimport\s*\(\s*["']([^"']+)["']/g,
];
const specifiers = (text) =>
  SPECIFIER_PATTERNS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1]));

test("package.json declares no dependencies (README 1.3)", () => {
  for (const key of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    assert.equal(key in pkg, false, `package.json has "${key}"`);
  }
});

test("the published files are src/ and README.md only", () => {
  assert.deepEqual(pkg.files, ["src/", "README.md"]);
});

test("src imports only relative paths and node: built-ins (README 1.3)", () => {
  const all = srcFiles.flatMap((file) =>
    specifiers(read(file)).map((spec) => ({ file, spec })),
  );
  // The patterns must find the imports that exist. Otherwise this test checks nothing.
  assert.ok(all.some(({ spec }) => spec === "node:crypto"));
  assert.ok(all.some(({ spec }) => spec === "./errors.js"));
  const bad = all
    .filter(
      ({ spec }) =>
        !spec.startsWith("./") &&
        !spec.startsWith("../") &&
        !spec.startsWith("node:"),
    )
    .map(({ file, spec }) => `${relative(root, file)}: ${spec}`);
  assert.deepEqual(bad, []);
});

test("the import patterns find every import form", () => {
  const text = [
    'import a from "x1";',
    "import {",
    "  b,",
    '} from "x2";',
    'import "x3";',
    'export { c } from "x4";',
    'export * from "x5";',
    'const d = await import("x6");',
    'import type { E } from "x7";',
  ].join("\n");
  assert.deepEqual(specifiers(text).sort(), [
    "x1",
    "x2",
    "x3",
    "x4",
    "x5",
    "x6",
    "x7",
  ]);
});

test("src uses no async context (README 1.5)", () => {
  const bad = [];
  for (const file of srcFiles) {
    const text = read(file);
    for (const word of ["async_hooks", "AsyncLocalStorage", "AsyncResource"]) {
      if (text.includes(word)) bad.push(`${relative(root, file)}: ${word}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("src has no TypeScript sources except the .d.ts files (README 1.4)", () => {
  const bad = srcFiles
    .filter((f) => /\.[cm]?tsx?$/.test(f) && !f.endsWith(".d.ts"))
    .map((f) => relative(root, f));
  assert.deepEqual(bad, []);
});

// require(esm) fails for a module graph that uses top-level await. So a successful
// require() shows that src has none (README 1.4).
test("CommonJS code can require() the entry point", () => {
  const require = createRequire(import.meta.url);
  const main = require("../src/index.js");
  assert.equal(typeof main.withDurableExecution, "function");
});

test("every public export has a type declaration (README 1.4)", async () => {
  for (const [js, dts] of [["../src/index.js", "src/index.d.ts"]]) {
    const names = Object.keys(await import(js));
    assert.ok(names.length > 0);
    const types = read(join(root, dts));
    const missing = names.filter(
      (name) =>
        !new RegExp(
          `\\bexport\\s+(?:declare\\s+)?(?:function|class|const|let|interface|type)\\s+${name}\\b`,
        ).test(types),
    );
    assert.deepEqual(missing, [], `missing in ${dts}`);
  }
});
