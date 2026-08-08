/**
 * Guards the core invariant: NO file in `@aws/durable-insight-core` may import ANY
 * host-specific module.
 *
 * WHY THIS IS BROADER THAN `vscode`:
 * The first version of this guard checked only for the VS Code API, which made the
 * rule look narrower than it is. Review proved the gap by prepending
 * `import { app } from "electron"` to a core module that no test happens to import:
 * eslint passed, `typecheck:hosts` passed, both host bundles built, and all 251
 * core tests passed. It would have shipped in silence.
 *
 * Each host has a different API — the extension host has `vscode`, the desktop app
 * has `electron`, the MCP server has neither and speaks the MCP SDK — so shared
 * code must reach for none of them. This guard now checks every one, and
 * `hostModuleScan.test.ts` fails if a fourth host is added without being listed.
 *
 * WHY A WHOLE-PACKAGE SCAN (not entry-point derivation):
 * The previous version lived in the VS Code extension package, back when core and
 * host code shared one package. Because that package legitimately contained
 * `vscode`-importing modules, the guard could not forbid it package-wide; instead
 * it scraped the desktop's relative `"../../.../src/X"` imports and walked the graph
 * from each. That was a workaround for the mixed package, not the invariant. Now
 * that core is its own package, every file here must be host-free whether or not a
 * host imports it today — which cannot miss a transitive path, and cannot silently
 * narrow when a host stops importing something.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { ALL_HOST_MODULES, findHostModules } from "./hostModuleScan";

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

const names = collectSourceFiles(SRC)
  .map((f) => relative(SRC, f))
  .sort();

describe("@aws/durable-insight-core is host-free", () => {
  // Without this, the guard below would pass by finding nothing to check -- the
  // failure mode of every file-enumerating test.
  it("finds the package's sources, including known members", () => {
    expect(names.length).toBeGreaterThan(20);
    for (const expected of [
      "explorerSession.ts",
      "hostPort.ts",
      "configCore.ts",
      "settingsKeys.ts",
      "index.ts",
      "hostModuleScan.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("checks against every known host module", () => {
    // Guards the guard's inputs: an empty candidate list would pass everything.
    expect(ALL_HOST_MODULES.length).toBeGreaterThanOrEqual(3);
  });

  it.each(names)("%s imports no host-specific module", (name) => {
    const found = findHostModules(readFileSync(join(SRC, name), "utf-8"));
    // Naming what was found makes the failure actionable rather than a bare false.
    expect(found).toEqual([]);
  });
});
