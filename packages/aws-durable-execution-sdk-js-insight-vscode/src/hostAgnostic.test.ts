/**
 * Guards that this package's two contexts each import only what they actually have.
 *
 * WHY THIS FILE EXISTS:
 * Core and the desktop package gained boundary guards after review found that a
 * host-specific import in shared code was invisible to every mechanism — an Electron
 * import in a core module that no test covered passed eslint, `typecheck:hosts`, both
 * bundles, and the whole suite. This package was the one host left without the mirror
 * guard, which also made a claim in the core README literally untrue.
 *
 * There are TWO contexts here, with different rules:
 *
 *   1. `src/` runs in the VS Code EXTENSION HOST. It may import `vscode` — that is
 *      the whole point of the package — but it has no Electron main process and does
 *      not speak the MCP protocol.
 *
 *   2. `webview-ui/src/` runs in a BROWSER. It has none of the three, including
 *      `vscode`: the renderer reaches the host through the `acquireVsCodeApi()`
 *      global and postMessage, never by importing the extension API. An `import`
 *      there would fail at runtime in the webview, where no bundler alias supplies
 *      it.
 *
 * The detector comes from `@aws/durable-insight-core`, where it is self-tested
 * against every module in every import form including subpaths. It is deliberately
 * not re-implemented: two divergent copies of a correctness-critical regex is the
 * duplication this package boundary exists to remove.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { HOST_MODULES, findHostModules } from "@aws/durable-insight-core";

const EXTENSION_SRC = __dirname;
const WEBVIEW_SRC = join(__dirname, "..", "webview-ui", "src");

function collectSourceFiles(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full, exts));
    } else if (
      exts.some((e) => entry.name.endsWith(e)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("extension host imports only its own host API", () => {
  /** The only host API the extension host may import. */
  const PERMITTED = HOST_MODULES.vscode;
  /** The other hosts' APIs, which do not exist in the extension host. */
  const FORBIDDEN = [HOST_MODULES.electron, HOST_MODULES.mcpSdk];

  const names = collectSourceFiles(EXTENSION_SRC, [".ts"])
    .map((f) => relative(EXTENSION_SRC, f))
    .sort();

  // Guards against the guard passing by finding nothing.
  it("finds its own sources, including known members", () => {
    expect(names.length).toBeGreaterThan(1);
    for (const expected of ["extension.ts", "config.ts"]) {
      expect(names).toContain(expected);
    }
  });

  it.each(names)("%s imports no other host's API", (name) => {
    const found = findHostModules(
      readFileSync(join(EXTENSION_SRC, name), "utf-8"),
      FORBIDDEN,
    );
    expect(found).toEqual([]);
  });

  it("does import vscode somewhere, so the check above is not vacuous", () => {
    // If this package stopped using the VS Code API, the FORBIDDEN list would be
    // quietly checking the wrong thing and this file should be revisited.
    const usesVsCode = names.some(
      (n) =>
        findHostModules(readFileSync(join(EXTENSION_SRC, n), "utf-8"), [
          PERMITTED,
        ]).length > 0,
    );
    expect(usesVsCode).toBe(true);
  });
});

describe("webview renderer imports no host API at all", () => {
  // The renderer is a browser context. It talks to the extension host through the
  // acquireVsCodeApi() global, so even `vscode` is forbidden here -- an import would
  // fail at runtime, where nothing supplies that module.
  const names = existsSync(WEBVIEW_SRC)
    ? collectSourceFiles(WEBVIEW_SRC, [".ts", ".tsx"])
        .map((f) => relative(WEBVIEW_SRC, f))
        .sort()
    : [];

  it("finds the renderer's sources", () => {
    // Fails loudly rather than skipping if the directory moves, so the guard cannot
    // silently stop covering the renderer.
    expect(existsSync(WEBVIEW_SRC)).toBe(true);
    expect(names.length).toBeGreaterThan(3);
    expect(names).toContain("App.tsx");
  });

  it.each(names)("%s imports no host API", (name) => {
    const found = findHostModules(
      readFileSync(join(WEBVIEW_SRC, name), "utf-8"),
    );
    expect(found).toEqual([]);
  });
});
