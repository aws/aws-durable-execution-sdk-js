#!/usr/bin/env node
/**
 * Asserts that every declared @biomejs/biome version in the workspace agrees.
 *
 * The pin appears in the root package.json and in six workspace packages, each
 * exact. Nothing else checks that they match, and a skew is silent in the worst
 * way: `npm run lint` at the root and `npm run lint -w <pkg>` would format the
 * same file differently, with no failure to reveal which one is right. Formatter
 * output is not stable across Biome minors, so this is a real hazard rather than
 * a hypothetical one.
 *
 * Exits 1 on any disagreement, or on a range where an exact pin is expected --
 * `^2.5.11` would let two installs of the same commit disagree.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TOOLS = ["@biomejs/biome", "prettier"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-cjs",
  "dist-types",
  "build",
  "out",
  "coverage",
]);

/**
 * Every package.json in the repo, found recursively.
 *
 * Recursive rather than `packages/*​/package.json` on purpose: nested manifests
 * exist and are exactly where a divergent pin would hide. `insight-vscode/webview-ui`
 * has its own `npm ci` in CI and owns the .tsx files Biome formats, so a Biome pin
 * appearing there later is the most likely source of the silent two-way formatting
 * this script exists to prevent -- and a glob one level deep would not see it.
 * `insight/cdk` is the same shape. Neither declares these tools today; the point is
 * that the check keeps working when one of them does.
 *
 * @returns {string[]}
 */
function findManifests(dir = ".", found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue; // broken symlink
    }
    if (stats.isDirectory()) findManifests(path, found);
    else if (entry === "package.json") found.push(path);
  }
  // The walk already yields "./package.json"; normalise it and put the root
  // manifest first so its pin is the one reported as canonical. Deduplicated
  // deliberately -- an earlier version unshifted the root unconditionally and
  // double-counted it, which inflated every "N declaration(s)" message by one.
  if (dir !== ".") return found;
  const normalised = [
    ...new Set(found.map((f) => (f === "./package.json" ? "package.json" : f))),
  ];
  return normalised.sort((a, b) =>
    a === "package.json" ? -1 : b === "package.json" ? 1 : a.localeCompare(b),
  );
}

/** @returns {{file: string, version: string}[]} */
function declarationsOf(tool, manifests) {
  const found = [];
  for (const file of manifests) {
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    for (const field of ["dependencies", "devDependencies"]) {
      const version = pkg[field]?.[tool];
      if (version) found.push({ file, version });
    }
  }
  return found;
}

const manifests = findManifests();
const problems = [];

for (const tool of TOOLS) {
  const declarations = declarationsOf(tool, manifests);
  if (declarations.length === 0) continue;

  const versions = new Set(declarations.map((d) => d.version));
  if (versions.size > 1) {
    problems.push(
      `${tool} is declared at ${versions.size} different versions:\n` +
        declarations
          .map((d) => `    ${d.version.padEnd(12)} ${d.file}`)
          .join("\n") +
        `\n  Bump every declaration together, or delete the per-package ones.`,
    );
  }

  // An exact pin is the point: a range reintroduces the skew this guards against.
  const ranged = declarations.filter((d) =>
    /^[\^~><=*]|\s-\s|\|\|/.test(d.version),
  );
  if (ranged.length > 0) {
    problems.push(
      `${tool} must be pinned exact, but is a range in:\n` +
        ranged.map((d) => `    ${d.version.padEnd(12)} ${d.file}`).join("\n"),
    );
  }
}

if (problems.length > 0) {
  console.error("Tool version pins are out of sync.\n");
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}

for (const tool of TOOLS) {
  const declarations = declarationsOf(tool, manifests);
  if (declarations.length === 0) continue;
  const [{ version }] = declarations;
  console.log(
    `${tool}: ${version} across ${declarations.length} declaration(s) — in sync.`,
  );
}
console.log(`Scanned ${manifests.length} package.json files.`);
