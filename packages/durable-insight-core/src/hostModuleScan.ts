/**
 * Detects whether a source file reaches a HOST-SPECIFIC module — one that only
 * exists inside a particular host process.
 *
 * WHY THIS IS NOT JUST ABOUT `vscode`:
 * The first version of this guard only knew about the VS Code API, which made the
 * invariant look narrower than it is. Review demonstrated the gap by adding an
 * Electron import to a core module that no test happens to import: eslint,
 * `typecheck:hosts`, both host bundles, and all 251 core tests passed. The real rule
 * is that core must not reach ANY host's API, because each host has a different one:
 *
 *   - the VS Code extension host has `vscode` and no Electron main process
 *   - the desktop app has `electron` and no VS Code API
 *   - the MCP server is plain Node and has neither
 *
 * A host-specific import in shared code therefore breaks the other hosts at
 * runtime, not at compile time, and possibly only on a path nobody exercises
 * during review — which is exactly why this is enforced mechanically.
 *
 * NOTE ON THIS FILE'S COMMENTS: they deliberately do not spell out import forms
 * literally. The whole-package guard scans every non-test file in this package,
 * including this one, so a literal example here would make the detector flag
 * itself. Every form is an executable case in `hostModuleScan.test.ts`.
 */

/**
 * Modules that belong to exactly one host. Shared code must import none of them;
 * each host may import its own and no other. `hostAgnostic.test.ts` in each package
 * encodes which are permitted where.
 */
export const HOST_MODULES = {
  /** VS Code extension API — only the extension host has it. */
  vscode: "vscode",
  /** Electron main/renderer API — only the desktop app has it. */
  electron: "electron",
  /** MCP protocol SDK — only the MCP server host speaks it. */
  mcpSdk: "@modelcontextprotocol/sdk",
} as const;

/** Every host-specific module. Core must import none of these. */
export const ALL_HOST_MODULES: readonly string[] = Object.values(HOST_MODULES);

/**
 * True if `source` imports `moduleName`, or any subpath of it, in any form
 * TypeScript or Node accepts: a static import, a bare side-effect import, a
 * CommonJS require, or a dynamic import.
 *
 * Subpaths are matched deliberately. The MCP SDK is only ever imported by subpath
 * (`.../server/mcp.js`), so an exact-specifier match would have missed every real
 * usage while looking like it worked — the same shape of hole as the bare
 * side-effect import that #795 shipped.
 *
 * The trailing boundary is a quote or a `/`, so a module whose name merely starts
 * with another's is not a false positive: `vscode-languageserver` does not match
 * `vscode`.
 *
 * Deliberately a lexical scan rather than a parse. It enforces a boundary, so
 * over-matching is a safe failure and under-matching is not: a false positive is a
 * two-second fix, a false negative breaks a host in production.
 */
export function importsHostModule(source: string, moduleName: string): boolean {
  // The specifier, optionally followed by a subpath, inside either quote style.
  const spec = `["']${escapeRegExp(moduleName)}(?:/[^"']*)?["']`;
  return (
    new RegExp(`\\bfrom\\s*${spec}`).test(source) ||
    new RegExp(`(^|;)\\s*import\\s*${spec}`, "m").test(source) ||
    new RegExp(`\\brequire\\s*\\(\\s*${spec}\\s*\\)`).test(source) ||
    new RegExp(`\\bimport\\s*\\(\\s*${spec}\\s*\\)`).test(source)
  );
}

/** The host modules from `candidates` that `source` imports. Empty is the goal. */
export function findHostModules(
  source: string,
  candidates: readonly string[] = ALL_HOST_MODULES,
): string[] {
  return candidates.filter((m) => importsHostModule(source, m));
}

/**
 * Every relative import specifier in `source`, in any of the four forms.
 *
 * Used by {@link findEscapingImports}; exported for its own tests.
 */
export function relativeImportSpecifiers(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s*["'](\.[^"']*)["']/g,
    /(?:^|;)\s*import\s*["'](\.[^"']*)["']/gm,
    /\brequire\s*\(\s*["'](\.[^"']*)["']\s*\)/g,
    /\bimport\s*\(\s*["'](\.[^"']*)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) found.add(m[1]);
  }
  return [...found];
}

/**
 * Relative imports in `source` that resolve OUTSIDE `packageRoot` — i.e. that reach
 * into a sibling package instead of depending on it by name.
 *
 * WHY THIS IS NOT JUST A `../../` STRING CHECK:
 * whether a relative import escapes depends on how deep the importing file is. A
 * module in `src/a/b/` may legitimately write `../../` and still be inside the
 * package. So the specifier is resolved against the importing file's directory and
 * compared with the package root, which is depth-independent and cannot be fooled by
 * an extra path segment.
 *
 * WHY IT MATTERS:
 * this is the defect the extraction existed to fix, and it was left with no gate that
 * runs on a pull request. Worse, a host-module scan cannot see through it: a core file
 * that reaches sideways into the VS Code package pulls in the `vscode` API
 * transitively while containing no host-module import of its own, so a per-file scan
 * reports it clean.
 */
export function findEscapingImports(
  filePath: string,
  source: string,
  packageRoot: string,
): string[] {
  const dir = pathDirname(filePath);
  const root = normalizeSlashes(packageRoot).replace(/\/+$/, "");
  return relativeImportSpecifiers(source).filter((spec) => {
    const resolved = normalizeSlashes(pathResolve(dir, spec));
    return resolved !== root && !resolved.startsWith(root + "/");
  });
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function pathDirname(p: string): string {
  const n = normalizeSlashes(p);
  const i = n.lastIndexOf("/");
  return i <= 0 ? "/" : n.slice(0, i);
}

/** Minimal POSIX-style resolve; avoids importing node:path into shared code. */
function pathResolve(from: string, spec: string): string {
  const parts = normalizeSlashes(from).split("/");
  for (const seg of normalizeSlashes(spec).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
