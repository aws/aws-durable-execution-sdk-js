/**
 * Guards the core invariant: NO file in `durable-insight-core` may import the
 * `vscode` API, at all.
 *
 * WHY THIS DESIGN CHANGED (entry-point derivation -> whole-package scan):
 * The previous version of this guard lived in the VS Code extension package,
 * back when core code and host code shared a single package. Because that
 * package legitimately contained `vscode`-importing modules (extension.ts,
 * config.ts) alongside the host-free ones, the guard couldn't simply forbid
 * `vscode` package-wide. Instead it reconstructed the set of modules the
 * desktop (Electron) host actually consumed — by scraping the desktop's
 * relative `"../../.../src/X"` imports — and walked the import graph transitively
 * from each of those entry points, asserting none reached `vscode`.
 *
 * That entry-point derivation was a workaround for the mixed package, not the
 * real invariant. Now that the host-free code IS its own package
 * (`durable-insight-core`) and the hosts depend on it via the bare specifier
 * `durable-insight-core`, the invariant is both simpler and STRICTLY STRONGER:
 * every file in this package must be host-free, whether or not any host happens
 * to import it today. Scanning every source file cannot miss a transitive path
 * (transitivity is subsumed — the target of any import is itself scanned), and
 * it can't silently narrow if a host stops importing some module. The old
 * transitive walk is therefore not lost by accident; it is deliberately
 * replaced by something that covers more.
 */
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

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

/**
 * True if `src` imports the `vscode` module in any syntactic form. Both forms
 * below matter; in PR #795 the original fixture only exercised the binding
 * forms and missed the bare side-effect import, and that gap was only caught by
 * deliberately breaking the test.
 */
function importsVsCode(src: string): boolean {
  return (
    // import * as vscode from "vscode"  /  import { x } from "vscode"
    /\bfrom\s*["']vscode["']/.test(src) ||
    // bare side-effect import: import "vscode";  (binds nothing, easy to miss)
    /(^|;)\s*import\s*["']vscode["']/m.test(src) ||
    // require("vscode") / dynamic import("vscode")
    /\brequire\s*\(\s*["']vscode["']\s*\)/.test(src) ||
    /\bimport\s*\(\s*["']vscode["']\s*\)/.test(src)
  );
}

const sourceFiles = collectSourceFiles(SRC).sort();
const relNames = sourceFiles.map((f) => relative(SRC, f));

describe("durable-insight-core is host-free", () => {
  it("enumerates the core sources and includes known host-free modules", () => {
    // A scan that silently found zero files would make every it.each case below
    // vacuous, so pin that the enumeration is non-empty and sees real members.
    // (Preserves the intent of the old "derives the entry points" test.)
    expect(relNames.length).toBeGreaterThan(0);
    for (const member of [
      "explorerSession.ts",
      "hostPort.ts",
      "configCore.ts",
      "settingsKeys.ts",
      "index.ts",
    ]) {
      expect(relNames).toContain(member);
    }
  });

  it.each(sourceFiles.map((f) => [relative(SRC, f), f] as const))(
    "%s does not import the vscode API",
    (_name, file) => {
      expect(importsVsCode(readFileSync(file, "utf-8"))).toBe(false);
    },
  );

  describe("detects a vscode import (guards the guard)", () => {
    /**
     * Write a fixture into core's own src, run `assert` against it, and always
     * remove it. Proves the detector can actually fail rather than being vacuous.
     */
    function withFixture(contents: string, assert: (file: string) => void) {
      const file = join(SRC, "__vscode_guard_fixture__.ts");
      writeFileSync(file, contents);
      try {
        assert(file);
      } finally {
        rmSync(file, { force: true });
      }
    }

    it("flags the namespace/named import form", () => {
      withFixture('import * as vscode from "vscode";\n', (file) => {
        expect(importsVsCode(readFileSync(file, "utf-8"))).toBe(true);
      });
    });

    it("flags the bare side-effect import form", () => {
      withFixture('import "vscode";\n', (file) => {
        expect(importsVsCode(readFileSync(file, "utf-8"))).toBe(true);
      });
    });
  });
});
