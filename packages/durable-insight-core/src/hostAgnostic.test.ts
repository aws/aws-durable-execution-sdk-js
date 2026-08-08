/**
 * Guards the core invariant: NO file in `@aws/durable-insight-core` may import the
 * `vscode` API, at all.
 *
 * WHY THIS DESIGN CHANGED (entry-point derivation -> whole-package scan):
 * The previous version of this guard lived in the VS Code extension package, back
 * when core code and host code shared a single package. Because that package
 * legitimately contained `vscode`-importing modules (extension.ts, config.ts)
 * alongside the host-free ones, the guard could not simply forbid `vscode`
 * package-wide. Instead it reconstructed the set of modules the desktop (Electron)
 * host actually consumed -- by scraping the desktop's relative `"../../.../src/X"`
 * imports -- and walked the import graph transitively from each entry point.
 *
 * That derivation was a workaround for the mixed package, not the real invariant.
 * Now that the host-free code IS its own package and the hosts depend on it by
 * bare specifier, the invariant is simpler and STRICTLY STRONGER: every file here
 * must be host-free, whether or not a host imports it today. Scanning every file
 * cannot miss a transitive path (the target of any import is itself scanned) and
 * cannot silently narrow if a host stops importing something.
 *
 * The detector itself lives in `./vscodeImportScan` and is self-tested in
 * `vscodeImportScan.test.ts`. It is deliberately NOT re-implemented here: it was
 * previously copy-pasted into the desktop host's equivalent guard, and two
 * divergent copies of a correctness-critical regex is the duplication this package
 * exists to eliminate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { importsVsCode } from "./vscodeImportScan";

const SRC = __dirname;

/** Every non-test `.ts` file under core's src, recursively (includes index.ts). */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = collectSourceFiles(SRC);
const names = files.map((f) => relative(SRC, f));

describe("@aws/durable-insight-core is host-free", () => {
  // Without this, the guard below would pass by finding nothing to check -- the
  // failure mode of every file-enumerating test.
  it("finds the package's sources, including known members", () => {
    expect(files.length).toBeGreaterThan(20);
    for (const expected of [
      "explorerSession.ts",
      "hostPort.ts",
      "configCore.ts",
      "settingsKeys.ts",
      "index.ts",
      "vscodeImportScan.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it.each(names)("%s does not import the vscode API", (name) => {
    expect(importsVsCode(readFileSync(join(SRC, name), "utf-8"))).toBe(false);
  });
});
