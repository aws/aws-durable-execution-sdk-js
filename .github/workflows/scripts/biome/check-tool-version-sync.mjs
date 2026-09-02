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

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const TOOLS = ["@biomejs/biome", "prettier"];
const PACKAGES_DIR = "packages";

/** @returns {{file: string, version: string}[]} */
function declarationsOf(tool) {
  const found = [];
  const manifests = ["package.json"];

  if (existsSync(PACKAGES_DIR)) {
    for (const entry of readdirSync(PACKAGES_DIR)) {
      const candidate = join(PACKAGES_DIR, entry, "package.json");
      if (existsSync(candidate)) manifests.push(candidate);
    }
  }

  for (const file of manifests) {
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    for (const field of ["dependencies", "devDependencies"]) {
      const version = pkg[field]?.[tool];
      if (version) found.push({ file, version });
    }
  }
  return found;
}

const problems = [];

for (const tool of TOOLS) {
  const declarations = declarationsOf(tool);
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
  const declarations = declarationsOf(tool);
  if (declarations.length === 0) continue;
  const [{ version }] = declarations;
  console.log(
    `${tool}: ${version} across ${declarations.length} declaration(s) — in sync.`,
  );
}
