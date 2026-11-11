// Run with `node --test scripts/*.test.mjs`. `npm run check:package` runs it first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findPackageProblems } from "./check-package-contents.mjs";

const clean = ["dist/index.mjs", "dist-types/index.d.ts", "package.json"];

test("accepts a clean tarball with sideEffects false", () => {
  assert.deepEqual(findPackageProblems(clean, { sideEffects: false }), []);
});

test("rejects a test declaration", () => {
  const [problem] = findPackageProblems(
    [...clean, "dist-types/step.test.d.ts"],
    { sideEffects: false },
  );
  assert.match(problem, /dist-types\/step\.test\.d\.ts/);
});

test("rejects a type test declaration", () => {
  const [problem] = findPackageProblems(
    [...clean, "dist-types/types/context.test-d.d.ts"],
    { sideEffects: false },
  );
  assert.match(problem, /context\.test-d\.d\.ts/);
});

test("rejects a declaration map", () => {
  const [problem] = findPackageProblems(
    [...clean, "dist-types/index.d.ts.map"],
    { sideEffects: false },
  );
  assert.match(problem, /index\.d\.ts\.map/);
});

test("rejects a missing sideEffects field", () => {
  assert.deepEqual(findPackageProblems(clean, {}), [
    'package.json must set "sideEffects": false',
  ]);
});

test("rejects sideEffects true", () => {
  assert.equal(findPackageProblems(clean, { sideEffects: true }).length, 1);
});
