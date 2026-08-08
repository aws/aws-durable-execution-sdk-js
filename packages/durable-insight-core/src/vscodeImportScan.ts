/**
 * Detects whether a source file reaches the VS Code extension API.
 *
 * This lives in the shared core, and is not test-only, for one reason: it was
 * previously copy-pasted into both this package's and the desktop host's boundary
 * tests. Two divergent copies of a correctness-critical regex is exactly the
 * duplication this package exists to remove, and the desktop copy had no
 * self-tests at all -- so a regression in its version would have passed silently
 * forever while still reporting green.
 *
 * One copy, one set of self-tests, both hosts.
 *
 * NOTE ON THIS FILE'S COMMENTS: they deliberately do not spell out the import
 * forms literally. The whole-package guard that uses this function scans every
 * non-test file in the package, including this one, so a literal example in a
 * comment here would make the detector flag itself. Every form covered is written
 * out as an executable case in `vscodeImportScan.test.ts` -- read that for the
 * concrete syntax. Examples belong where they run, not restated in prose.
 */

/** The module specifier that only the VS Code extension host may import. */
export const VSCODE_MODULE = "vscode";

/**
 * True if `source` reaches the VS Code API in any form TypeScript or Node accepts.
 * Four are covered, and each is a separate case in the test file:
 *
 *   1. A static import naming the module -- namespace, named, default, or
 *      type-only. All share the `from <module>` shape.
 *   2. A bare side-effect import, which binds no name. Easy to miss when
 *      eyeballing a diff, and a fixture that omitted it is how #795 shipped a
 *      guard with a hole in it.
 *   3. A CommonJS require call, reachable through interop.
 *   4. A dynamic import call, which defers loading but still couples the module to
 *      an API the other hosts do not have.
 *
 * Deliberately a lexical scan rather than a parse. It enforces a boundary, so
 * over-matching is a safe failure and under-matching is not: a false positive is a
 * two-second fix, whereas a false negative breaks a host at runtime on some path
 * nobody exercised during review.
 */
export function importsVsCode(source: string): boolean {
  const m = VSCODE_MODULE;
  const q = `["']${m}["']`;
  return (
    new RegExp(`\\bfrom\\s*${q}`).test(source) ||
    new RegExp(`(^|;)\\s*import\\s*${q}`, "m").test(source) ||
    new RegExp(`\\brequire\\s*\\(\\s*${q}\\s*\\)`).test(source) ||
    new RegExp(`\\bimport\\s*\\(\\s*${q}\\s*\\)`).test(source)
  );
}
