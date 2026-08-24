#!/usr/bin/env node
// @ts-check
//
// Tests for check-legal-files.js, run against throwaway fixture repos rather
// than the real tree: a check that only ever sees a passing repo is not known to
// fail on anything. Each case reproduces one way legal metadata goes missing,
// starting with the one that actually shipped -- the ESLint plugin publishing
// 0.0.1 through 1.1.0 with no `license` field.
//
//   node --test .github/workflows/scripts/legal/*.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { check, parseReleaseList } from "./check-legal-files.js";

const LICENSE_TEXT = "Apache License\nVersion 2.0\n";
const NOTICE_TEXT =
  "Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.\n";

/**
 * A minimal repo laid out the way the real one is: root LICENSE/NOTICE, a
 * publish script with a PACKAGES array, and `packages/<name>/`.
 *
 * @param {Record<string, {manifest: Record<string, any>, legalFiles?: Record<string, string>}>} packages
 * @param {string[]} releaseList package dirs, e.g. ["packages/sdk"]
 * @returns {string} the fixture repo root
 */
function makeRepo(packages, releaseList) {
  const root = mkdtempSync(join(tmpdir(), "legal-files-test-"));
  writeFileSync(join(root, "LICENSE"), LICENSE_TEXT);
  writeFileSync(join(root, "NOTICE"), NOTICE_TEXT);

  const scriptDir = join(root, ".github/workflows");
  mkdirSync(scriptDir, { recursive: true });
  writeFileSync(
    join(scriptDir, "iterate-publish-npm.sh"),
    [
      "#!/bin/bash",
      'if [ -n "${TEST_PACKAGES:-}" ]; then',
      '  read -ra PACKAGES <<< "$TEST_PACKAGES"',
      "else",
      "  PACKAGES=(",
      ...releaseList.map((dir) => `    "${dir}"`),
      "  )",
      "fi",
      "",
    ].join("\n"),
  );

  for (const [name, spec] of Object.entries(packages)) {
    const dir = join(root, "packages", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(spec.manifest, null, 2),
    );
    for (const [file, contents] of Object.entries(spec.legalFiles ?? {})) {
      writeFileSync(join(dir, file), contents);
    }
  }
  return root;
}

/** A package that satisfies every rule. */
function compliantReleased(name) {
  return {
    manifest: {
      name,
      version: "1.0.0",
      license: "Apache-2.0",
      files: ["dist/", "LICENSE", "NOTICE"],
      private: false,
    },
    legalFiles: { LICENSE: LICENSE_TEXT, NOTICE: NOTICE_TEXT },
  };
}

/**
 * @param {Record<string, any>} packages
 * @param {string[]} releaseList
 * @returns {string[]}
 */
function checkFixture(packages, releaseList) {
  const root = makeRepo(packages, releaseList);
  try {
    return check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a compliant repo reports no problems", () => {
  const errors = checkFixture({ sdk: compliantReleased("sdk") }, [
    "packages/sdk",
  ]);
  assert.deepEqual(errors, []);
});

test("catches a released package with no license field (the d7bbfc3 bug)", () => {
  const pkg = compliantReleased("eslint-plugin");
  delete pkg.manifest.license;
  const errors = checkFixture({ "eslint-plugin": pkg }, [
    "packages/eslint-plugin",
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing "license" field/);
});

test("catches a private package with no license field", () => {
  const errors = checkFixture(
    { core: { manifest: { name: "core", version: "1.0.0", private: true } } },
    ["packages/sdk"],
  );
  assert.ok(
    errors.some((e) => /core\/package\.json: missing "license" field/.test(e)),
  );
});

test("catches a package that is publishable but not on the release list", () => {
  const errors = checkFixture(
    {
      sdk: compliantReleased("sdk"),
      // No "private": true, and absent from the release list -- exactly the
      // state the three integration-test packages were in.
      "esm-integration-test": {
        manifest: {
          name: "esm-integration-test",
          version: "1.0.0",
          license: "Apache-2.0",
        },
      },
    },
    ["packages/sdk"],
  );
  assert.equal(errors.length, 1);
  assert.match(
    errors[0],
    /publishable \(no "private": true\) but not listed for release/,
  );
});

test("accepts a private package that is absent from the release list", () => {
  const errors = checkFixture(
    {
      sdk: compliantReleased("sdk"),
      examples: {
        manifest: {
          name: "examples",
          version: "1.0.0",
          license: "Apache-2.0",
          private: true,
        },
      },
    },
    ["packages/sdk"],
  );
  assert.deepEqual(errors, []);
});

test("catches a released package missing the NOTICE file", () => {
  const pkg = compliantReleased("sdk");
  pkg.legalFiles = { LICENSE: LICENSE_TEXT };
  const errors = checkFixture({ sdk: pkg }, ["packages/sdk"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /sdk\/NOTICE: missing/);
});

test("catches legal files that have drifted from the repo root copies", () => {
  const pkg = compliantReleased("sdk");
  pkg.legalFiles = { LICENSE: "MIT License\n", NOTICE: NOTICE_TEXT };
  const errors = checkFixture({ sdk: pkg }, ["packages/sdk"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /sdk\/LICENSE: does not match the repo root LICENSE/);
});

test("catches legal files present on disk but absent from the files array", () => {
  // The subtle one: NOTICE exists in the package but npm would not pack it,
  // because an explicit `files` array excludes anything it does not name.
  const pkg = compliantReleased("sdk");
  pkg.manifest.files = ["dist/", "LICENSE"];
  const errors = checkFixture({ sdk: pkg }, ["packages/sdk"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"files" does not include "NOTICE"/);
});

test("catches a released package with no files array at all", () => {
  const pkg = compliantReleased("sdk");
  delete pkg.manifest.files;
  const errors = checkFixture({ sdk: pkg }, ["packages/sdk"]);
  assert.ok(errors.some((e) => /must declare a "files" array/.test(e)));
});

test("catches a release list entry that points at nothing", () => {
  const errors = checkFixture({ sdk: compliantReleased("sdk") }, [
    "packages/sdk",
    "packages/deleted-package",
  ]);
  assert.equal(errors.length, 1);
  assert.match(
    errors[0],
    /deleted-package: listed for release .* but has no package\.json/,
  );
});

test("parseReleaseList reads the literal array, not the TEST_PACKAGES override", () => {
  const root = makeRepo({ sdk: compliantReleased("sdk") }, [
    "packages/a",
    "packages/b",
  ]);
  try {
    assert.deepEqual(
      parseReleaseList(join(root, ".github/workflows/iterate-publish-npm.sh")),
      ["packages/a", "packages/b"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseReleaseList fails loudly if the array cannot be found", () => {
  const root = mkdtempSync(join(tmpdir(), "legal-files-test-"));
  const scriptPath = join(root, "iterate-publish-npm.sh");
  writeFileSync(scriptPath, "#!/bin/bash\necho no array here\n");
  try {
    assert.throws(
      () => parseReleaseList(scriptPath),
      /could not find a PACKAGES/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real repository passes", () => {
  assert.deepEqual(check(), []);
});
