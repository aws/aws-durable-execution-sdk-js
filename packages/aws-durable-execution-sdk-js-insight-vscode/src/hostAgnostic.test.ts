/**
 * Guards the property the desktop app depends on: the shared modules are
 * host-free.
 *
 * `explorerSession.ts` and its dependencies get bundled into an Electron app
 * where `vscode` does not exist, so a single `import * as vscode` anywhere in
 * that graph breaks the desktop build. That failure is easy to reintroduce —
 * `./config` and `./configCore` differ by four characters — and the error it
 * produces ("Could not resolve vscode") points at the imported file rather than
 * the import that pulled it in.
 *
 * So this walks the real import graph from the modules the desktop entry points
 * consume and asserts none of them reaches the VS Code API. When it fails, it
 * prints the chain, which is the part that actually tells you what to fix.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

/** The modules the desktop package imports directly (see its src/). */
const DESKTOP_ENTRY_POINTS = [
  "explorerSession.ts",
  "configCore.ts",
  "hostPort.ts",
  "settingsKeys.ts",
];

const SRC = __dirname;

function resolveImport(fromFile: string, spec: string): string | undefined {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && candidate.endsWith(".ts")) return candidate;
  }
  return undefined;
}

/** Relative-import specifiers in `src`, including side-effect-only imports. */
function importSpecifiers(src: string): string[] {
  const specs = new Set<string>();
  for (const re of [
    /\bfrom\s*["'](\.[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
    // `import "./x";` binds nothing, so it has no `from` — and it can still
    // pull in a module that imports vscode.
    /^\s*import\s*["'](\.[^"']+)["']/gm,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) specs.add(m[1]);
  }
  return [...specs];
}

function importsVsCode(src: string): boolean {
  return (
    /\bfrom\s*["']vscode["']/.test(src) ||
    /\brequire\s*\(\s*["']vscode["']\s*\)/.test(src)
  );
}

/**
 * Walk from `entry` and return the first path that reaches a `vscode` import,
 * as a chain of repo-relative filenames, or undefined if none does.
 */
function findVsCodePath(entry: string, root = SRC): string[] | undefined {
  const seen = new Set<string>();
  const stack: { file: string; chain: string[] }[] = [
    { file: entry, chain: [relative(root, entry)] },
  ];

  while (stack.length > 0) {
    const { file, chain } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const src = readFileSync(file, "utf-8");
    if (importsVsCode(src)) return chain;

    for (const spec of importSpecifiers(src)) {
      const target = resolveImport(file, spec);
      // A specifier that resolves to nothing is a package import (or a .json),
      // neither of which can pull in `vscode`.
      if (target && !target.endsWith(".test.ts")) {
        stack.push({ file: target, chain: [...chain, relative(root, target)] });
      }
    }
  }
  return undefined;
}

describe("host-agnostic module graph", () => {
  it.each(DESKTOP_ENTRY_POINTS)(
    "%s does not reach the vscode API",
    (entryName) => {
      const entry = join(SRC, entryName);
      expect(existsSync(entry)).toBe(true);
      const chain = findVsCodePath(entry);
      if (chain) {
        // The chain is the useful part of the failure: it names the import that
        // reintroduced the dependency, not just the file that ended up with it.
        throw new Error(
          `${entryName} reaches the vscode API via:\n  ${chain.join("\n  -> ")}`,
        );
      }
      expect(chain).toBeUndefined();
    },
  );

  it("still detects a vscode import when there is one (guards the guard)", () => {
    // extension.ts is the VS Code adapter and must import vscode, so it doubles
    // as proof that the walk above can actually fail rather than being vacuous.
    expect(findVsCodePath(join(SRC, "extension.ts"))).toEqual(["extension.ts"]);
    expect(findVsCodePath(join(SRC, "config.ts"))).toEqual(["config.ts"]);
  });

  it("follows transitive imports, not just direct ones", () => {
    // Built as a fixture because the real graph has no module that reaches
    // vscode indirectly — which is the point of this PR. A walk that only
    // checked direct imports would pass the assertions above and fail here.
    const dir = mkdtempSync(join(tmpdir(), "insight-graph-"));
    try {
      writeFileSync(
        join(dir, "leaf.ts"),
        'import * as vscode from "vscode";\n',
      );
      writeFileSync(join(dir, "middle.ts"), 'import "./leaf";\n');
      writeFileSync(join(dir, "entry.ts"), 'import { x } from "./middle";\n');
      const chain = findVsCodePath(join(dir, "entry.ts"), dir);
      expect(chain).toEqual(["entry.ts", "middle.ts", "leaf.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
