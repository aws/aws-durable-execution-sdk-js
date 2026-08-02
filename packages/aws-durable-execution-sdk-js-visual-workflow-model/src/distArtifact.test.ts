import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * This package is the only one whose build output is NESTED
 * (`dist/generated/apiDirectory.json`), which made it the only one the CI artifact
 * glob missed.
 *
 * `packages/**\/dist*\/*` matches `dist/index.js` but NOT
 * `dist/generated/apiDirectory.json`, because a trailing `*` does not cross a `/`.
 * `unit-tests.yml` downloads that artifact instead of rebuilding, so the file was
 * absent at test time, `dist/apiVendors.js` failed to require it, and the entire cdk
 * suite plus every insight-vscode suite importing it failed to run.
 */
describe("CI artifact glob covers nested build output", () => {
  const workflow = join(__dirname, "../../../.github/workflows/build.yml");

  it("the dist glob recurses instead of stopping at one level", () => {
    // No early return: skipping silently when the workflow file is missing meant
    // this test could PASS while asserting nothing — the same failure mode as the
    // glob it guards.
    expect(existsSync(workflow)).toBe(true);
    const yml = readFileSync(workflow, "utf-8");
    const globs = [...yml.matchAll(/^\s*(packages\/\S*dist\S*)\s*$/gm)].map(
      (m) => m[1],
    );
    expect(globs.length).toBeGreaterThan(0);
    for (const g of globs) {
      // A trailing single `*` cannot cross a `/`, so it silently omits nested
      // output. Asserted on the pattern rather than via a matcher to avoid adding
      // a dependency for one check.
      expect(g.endsWith("/**")).toBe(true);
      expect(/dist\*?\/\*$/.test(g)).toBe(false);
    }
  });

  it("the loader's asset path is the nested one this guards", () => {
    // If the asset ever moves to the dist root, this test is obsolete rather than
    // wrong — so assert the coupling explicitly.
    const src = readFileSync(join(__dirname, "apiVendors.ts"), "utf-8");
    expect(src).toContain("./generated/apiDirectory.json");
  });
});
