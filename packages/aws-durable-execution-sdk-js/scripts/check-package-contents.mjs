// biome-ignore-all lint/suspicious/noConsole: a CLI check whose console output is its report.
// Fails when the packed tarball holds test declarations or source maps for
// declarations, or when package.json loses "sideEffects": false. The 3.0.0
// tarball shipped 118 *.test.d.ts files and had no "sideEffects" field.
// attw and publint do not check either.
//
// check-package-contents.test.mjs tests findPackageProblems.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * @param {string[]} paths - the file paths in the tarball
 * @param {{ sideEffects?: unknown }} pkg - the parsed package.json
 * @returns {string[]} one message per problem, empty when there is none
 */
export const findPackageProblems = (paths, pkg) => {
  const problems = [];
  const unwanted = paths.filter((path) =>
    /\.test(-d)?\.d\.ts$|\.d\.ts\.map$/.test(path),
  );
  if (unwanted.length > 0) {
    problems.push(`unwanted files in the tarball:\n  ${unwanted.join("\n  ")}`);
  }
  if (pkg.sideEffects !== false) {
    problems.push('package.json must set "sideEffects": false');
  }
  return problems;
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [pack] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      encoding: "utf8",
    }),
  );
  const paths = pack.files.map((file) => file.path);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const problems = findPackageProblems(paths, pkg);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`${paths.length} files in the tarball, no unwanted files.`);
}
