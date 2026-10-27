#!/usr/bin/env node
// @ts-check
// Fail if any file a package.json points at is missing from the packed tarball.
// Builds twice so a stale build cache cannot mask a missing output.
// Defaults to every publishable package. Pass dirs to check only those.
// Usage: node verify-declared-files-shipped.mjs [packageDir...]

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readPkg = (/** @type {string} */ dir) =>
  JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));

// Publishable means npm would accept it, and there has to be a build to check.
function discover() {
  const root = resolve(import.meta.dirname, "../../../../packages");
  return readdirSync(root)
    .map((name) => resolve(root, name))
    .filter((dir) => existsSync(resolve(dir, "package.json")))
    .filter((dir) => {
      const pkg = readPkg(dir);
      return pkg.private !== true && pkg.scripts?.build;
    });
}

// Every path package.json points at, mapped to the fields declaring it.
function declaredFiles(/** @type {any} */ pkg) {
  /** @type {Map<string, string[]>} */
  const declared = new Map();
  const add = (/** @type {string} */ path, /** @type {string} */ field) => {
    if (!declared.has(path)) declared.set(path, []);
    declared.get(path)?.push(field);
  };
  for (const key of ["main", "module", "types"]) {
    if (typeof pkg[key] === "string") add(pkg[key], key);
  }
  const walk = (/** @type {unknown} */ node, /** @type {string} */ field) => {
    if (typeof node === "string") add(node, field);
    else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, `${field}[${JSON.stringify(key)}]`);
      }
    }
  };
  walk(pkg.exports, "exports");
  walk(pkg.bin, "bin");
  return declared;
}

/** @returns {boolean} whether the package is missing a file it declares */
function check(/** @type {string} */ dir) {
  const run = (/** @type {string[]} */ args) =>
    execFileSync("npm", args, { cwd: dir, stdio: "inherit" });

  // Mirrors what npm publish does: prebuild then build, over a previous build.
  run(["run", "build"]);
  run(["run", "prebuild", "--if-present"]);
  run(["run", "build"]);

  // --ignore-scripts: a prepack rebuild would both corrupt --json and hide the
  // stale output this checks for.
  const packed = new Set(
    JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: dir,
        encoding: "utf8",
      }),
    )[0].files.map((/** @type {{path:string}} */ f) => f.path),
  );

  const pkg = readPkg(dir);
  const declared = declaredFiles(pkg);
  const missing = [...declared.keys()].filter(
    (p) => !packed.has(p.replace(/^\.\//, "")),
  );

  if (missing.length === 0) {
    console.log(
      `${pkg.name}: npm pack includes all ${declared.size} file(s) package.json points at.`,
    );
    return false;
  }

  console.error(
    `\n${pkg.name}: package.json points at ${missing.length} file(s) that npm pack does not include:`,
  );
  for (const p of missing) {
    console.error(`  ${p}  declared by ${declared.get(p)?.join(", ")}`);
  }
  return true;
}

const dirs = process.argv.slice(2).map((d) => resolve(d));
const failed = (dirs.length > 0 ? dirs : discover()).filter(check);

if (failed.length > 0) {
  console.error(
    `\n${failed.length} package(s) point at files they do not ship. Consumers resolving those paths will fail.`,
  );
  process.exit(1);
}
