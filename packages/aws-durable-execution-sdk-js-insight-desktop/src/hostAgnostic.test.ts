/**
 * Guards that nothing in the desktop (Electron) package's own sources imports the
 * `vscode` API. This host has no VS Code extension API, so a stray
 * `import ... "vscode"` would break it at runtime.
 *
 * The detector is imported from `@aws/durable-insight-core`, not re-implemented.
 * It used to be a verbatim copy of core's regex with no self-tests of its own,
 * which meant a regression in this copy would have passed silently forever while
 * still reporting green. Core's `vscodeImportScan.test.ts` covers all four import
 * forms in one place; this file supplies only the enumeration.
 *
 * Together with core's package-wide guard, the two cover the whole desktop graph:
 * core proves the shared code is clean, this proves the host's own code is.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { importsVsCode } from "@aws/durable-insight-core";

const SRC = __dirname;

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

describe("desktop package is host-free", () => {
  // Guards against the guard passing by finding nothing.
  it("finds its own sources, including known members", () => {
    expect(names.length).toBeGreaterThan(3);
    for (const expected of ["main.ts", "host.ts", "settings.ts"]) {
      expect(names).toContain(expected);
    }
  });

  it.each(names)("%s does not import the vscode API", (name) => {
    expect(importsVsCode(readFileSync(join(SRC, name), "utf-8"))).toBe(false);
  });
});
