/**
 * Guards that the desktop (Electron) package imports only ITS OWN host API.
 *
 * `electron` is legitimate here — this IS the Electron host. What must not appear is
 * another host's API: `vscode` (this process has no extension API) or the MCP SDK
 * (that is a different host's protocol). So this is not simply "host-free"; it is
 * "this host and no other", which is why the permitted module is stated explicitly
 * rather than the whole list being banned.
 *
 * The detector is imported from `@aws/durable-execution-sdk-js-insight-core`, not re-implemented. It
 * used to be a verbatim copy of core's regex with no self-tests of its own, which
 * meant a regression in this copy would have passed silently forever while still
 * reporting green. Core's `hostModuleScan.test.ts` covers every module in every
 * import form, including subpaths; this file supplies only the enumeration.
 *
 * Together with core's package-wide guard, the two cover the whole desktop graph:
 * core proves the shared code reaches no host API, this proves the host reaches only
 * its own.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  HOST_MODULES,
  findEscapingImports,
  findHostModules,
} from "@aws/durable-execution-sdk-js-insight-core";

const SRC = __dirname;
/** The package root, i.e. the directory holding package.json. */
const PACKAGE_ROOT = join(__dirname, "..");

/** The only host API this package may import. */
const PERMITTED = HOST_MODULES.electron;

/** Every other host's API is forbidden here. */
const FORBIDDEN = [HOST_MODULES.vscode, HOST_MODULES.mcpSdk];

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

describe("desktop package imports only its own host API", () => {
  // Guards against the guard passing by finding nothing.
  it("finds its own sources, including known members", () => {
    expect(names.length).toBeGreaterThan(3);
    for (const expected of ["main.ts", "host.ts", "settings.ts"]) {
      expect(names).toContain(expected);
    }
  });

  // Per-file host scans cannot see a host API reached THROUGH a sibling package,
  // and reaching sideways is itself the defect the core extraction existed to fix.
  it.each(names)("%s does not reach into a sibling package", (name) => {
    const file = join(SRC, name);
    const escaping = findEscapingImports(
      file,
      readFileSync(file, "utf-8"),
      PACKAGE_ROOT,
    );
    expect(escaping).toEqual([]);
  });

  it.each(names)("%s imports no other host's API", (name) => {
    const found = findHostModules(
      readFileSync(join(SRC, name), "utf-8"),
      FORBIDDEN,
    );
    expect(found).toEqual([]);
  });

  it("does import electron somewhere, so the check above is not vacuous", () => {
    // If this package stopped using Electron entirely, the FORBIDDEN list above
    // would be silently checking the wrong thing, and this file should be revisited.
    const usesElectron = names.some(
      (n) =>
        findHostModules(readFileSync(join(SRC, n), "utf-8"), [PERMITTED])
          .length > 0,
    );
    expect(usesElectron).toBe(true);
  });
});
