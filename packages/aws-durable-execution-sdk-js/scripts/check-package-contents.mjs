// Fails when the packed tarball holds test declarations or source maps for
// declarations, or when package.json loses "sideEffects": false. The 3.0.0
// tarball shipped 118 *.test.d.ts files and had no "sideEffects" field.
// attw and publint do not check either.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [pack] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
  }),
);
const unwanted = pack.files
  .map((file) => file.path)
  .filter((path) => /\.test(-d)?\.d\.ts$|\.d\.ts\.map$/.test(path));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const problems = [];
if (unwanted.length > 0) {
  problems.push(`unwanted files in the tarball:\n  ${unwanted.join("\n  ")}`);
}
if (pkg.sideEffects !== false) {
  problems.push('package.json must set "sideEffects": false');
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${pack.files.length} files in the tarball, no unwanted files.`);
