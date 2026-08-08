/**
 * Guards that nothing in the desktop (Electron) package's own sources imports
 * the `vscode` API — this host has no VS Code extension API, so a stray
 * `import ... "vscode"` would break the build. Host-free shared code lives in
 * `durable-insight-core`, which enforces the same invariant package-wide in its
 * own hostAgnostic.test.ts; this small guard covers the desktop package's own
 * src, so the two together cover the whole desktop graph.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

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

function importsVsCode(src: string): boolean {
  return (
    /\bfrom\s*["']vscode["']/.test(src) ||
    /(^|;)\s*import\s*["']vscode["']/m.test(src) ||
    /\brequire\s*\(\s*["']vscode["']\s*\)/.test(src) ||
    /\bimport\s*\(\s*["']vscode["']\s*\)/.test(src)
  );
}

const sourceFiles = collectSourceFiles(SRC).sort();

describe("desktop package is host-free", () => {
  it("enumerates its own sources", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it.each(sourceFiles.map((f) => [relative(SRC, f), f] as const))(
    "%s does not import the vscode API",
    (_name, file) => {
      expect(importsVsCode(readFileSync(file, "utf-8"))).toBe(false);
    },
  );
});
