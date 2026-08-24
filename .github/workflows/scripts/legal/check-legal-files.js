#!/usr/bin/env node
// @ts-check
//
// Guards the legal metadata of every workspace package.
//
// Background: the ESLint plugin shipped 0.0.1 through 1.1.0 to npm with no
// `license` field at all, because nothing checked. It was fixed by hand in
// d7bbfc3 once someone noticed. This script is the check that would have caught
// it, and it also covers the second half of the same problem: the `license`
// field is only a metadata pointer, so a tarball can name Apache-2.0 while
// carrying none of its text. Every published package therefore also ships the
// LICENSE and NOTICE files themselves.
//
// The rules, applied to every directory under `packages/`:
//
//   1. `license` is declared. Private packages included -- a package that is
//      private today can be published tomorrow, and the field costs nothing.
//   2. A package is either `private: true` or listed for release in
//      iterate-publish-npm.sh. Anything else is publishable by accident:
//      `npm publish --workspaces` would push it to the registry. Three
//      integration-test packages sat in exactly that state.
//   3. Released packages carry LICENSE and NOTICE byte-identical to the repo
//      root copies, so they cannot drift from the canonical text.
//   4. Released packages list LICENSE and NOTICE in `files`. npm happens to
//      include LICENSE on its own, but it does NOT include NOTICE, and relying
//      on that implicit behaviour is how the text goes missing.
//
// The release list is parsed out of iterate-publish-npm.sh rather than
// duplicated here: adding a package to the release list without giving it legal
// files is precisely the mistake this should fail on, and a second hand-kept
// list would just drift.
//
// Deliberately dependency-free and I/O-only-on-the-repo, so CI can run it
// without `npm ci`.
//
// Usage:
//   node .github/workflows/scripts/legal/check-legal-files.js

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const PUBLISH_SCRIPT = ".github/workflows/iterate-publish-npm.sh";
const LEGAL_FILES = ["LICENSE", "NOTICE"];

/**
 * The package directories the release workflow publishes, read from the
 * `PACKAGES=( ... )` array in iterate-publish-npm.sh.
 *
 * @param {string} scriptPath
 * @returns {string[]} paths relative to the repo root, e.g. "packages/foo"
 */
export function parseReleaseList(scriptPath) {
  const source = readFileSync(scriptPath, "utf8");
  // The literal array, not the `TEST_PACKAGES` override branch above it.
  const block = /^\s*PACKAGES=\(([^)]*)\)/m.exec(source);
  if (!block) {
    throw new Error(`could not find a PACKAGES=( ... ) array in ${scriptPath}`);
  }
  const entries = block[1].match(/"([^"]+)"/g) || [];
  if (entries.length === 0) {
    throw new Error(`PACKAGES=( ... ) in ${scriptPath} is empty`);
  }
  return entries.map((entry) => entry.slice(1, -1));
}

/**
 * @param {string} path
 * @returns {Record<string, any>}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {string} repoRoot
 * @returns {string[]} package directory names under packages/
 */
function listPackageDirs(repoRoot) {
  const packagesDir = join(repoRoot, "packages");
  return readdirSync(packagesDir)
    .filter((name) => statSync(join(packagesDir, name)).isDirectory())
    .filter((name) => existsSync(join(packagesDir, name, "package.json")))
    .sort();
}

/**
 * @param {string} [repoRoot]
 * @returns {string[]} human-readable problems; empty means the repo is clean
 */
export function check(repoRoot = REPO_ROOT) {
  /** @type {string[]} */
  const errors = [];

  const canonical = new Map(
    LEGAL_FILES.map((name) => [name, readFileSync(join(repoRoot, name))]),
  );

  const released = new Set(parseReleaseList(join(repoRoot, PUBLISH_SCRIPT)));
  for (const dir of released) {
    if (!existsSync(join(repoRoot, dir, "package.json"))) {
      errors.push(
        `${dir}: listed for release in iterate-publish-npm.sh but has no package.json`,
      );
    }
  }

  for (const name of listPackageDirs(repoRoot)) {
    const dir = `packages/${name}`;
    const manifestPath = join(repoRoot, dir, "package.json");
    const manifest = readJson(manifestPath);
    const isReleased = released.has(dir);

    // Rule 1: everything declares a license.
    if (!manifest.license) {
      errors.push(`${dir}/package.json: missing "license" field`);
    }

    // Rule 2: private, or intentionally released. Nothing in between.
    if (manifest.private !== true && !isReleased) {
      errors.push(
        `${dir}/package.json: publishable (no "private": true) but not listed for release in ` +
          `iterate-publish-npm.sh. Add "private": true, or add ${dir} to the release list.`,
      );
    }

    if (!isReleased) continue;

    // Rules 3 and 4 apply to what actually reaches the registry.
    for (const legalFile of LEGAL_FILES) {
      const legalPath = join(repoRoot, dir, legalFile);
      if (!existsSync(legalPath)) {
        errors.push(
          `${dir}/${legalFile}: missing. Copy the repo root ${legalFile} into the package so it ` +
            `ships in the npm tarball.`,
        );
      } else if (!readFileSync(legalPath).equals(canonical.get(legalFile))) {
        errors.push(
          `${dir}/${legalFile}: does not match the repo root ${legalFile}`,
        );
      }

      const files = manifest.files;
      if (!Array.isArray(files)) {
        errors.push(
          `${dir}/package.json: released packages must declare a "files" array so the tarball ` +
            `contents are explicit`,
        );
      } else if (!files.includes(legalFile)) {
        errors.push(
          `${dir}/package.json: "files" does not include "${legalFile}"`,
        );
      }
    }
  }

  return errors;
}

function main() {
  let errors;
  try {
    errors = check();
  } catch (err) {
    console.error(
      `check-legal-files: ${err instanceof Error ? err.message : err}`,
    );
    return 2;
  }

  if (errors.length > 0) {
    console.error("Legal file checks failed:\n");
    for (const error of errors) console.error(`  ${error}`);
    console.error("");
    return 1;
  }

  const released = parseReleaseList(join(REPO_ROOT, PUBLISH_SCRIPT));
  console.log(
    `LICENSE and NOTICE present and listed in "files" for all ${released.length} released ` +
      `packages; every workspace package declares a license.`,
  );
  return 0;
}

// Only run when invoked directly, so the unit tests can import `check`.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
