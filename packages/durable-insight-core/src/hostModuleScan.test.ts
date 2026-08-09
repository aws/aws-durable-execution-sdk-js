/**
 * Self-tests for the host-module detector. Without these, a regression in
 * `importsHostModule` would make every boundary guard in the repository pass
 * vacuously.
 *
 * Two holes this suite exists to prevent, both of which were real:
 *
 *   1. The detector originally knew only about `vscode`, so `import { app } from
 *      "electron"` in a core module that no test imported passed every mechanism —
 *      eslint, typecheck, both bundles, all 251 tests.
 *   2. Matching the exact specifier would miss the MCP SDK entirely, since it is
 *      only ever imported by subpath (`.../server/mcp.js`).
 *
 * These do NOT write fixture files. An earlier version wrote a file into `src/`,
 * read it straight back, and asserted on the string — no coverage over calling the
 * detector directly, but a real failure mode: the path was not gitignored, and a
 * hard-killed run left a file the next enumeration would pick up, failing with a
 * misleading complaint about a filename nobody wrote.
 */
import {
  ALL_HOST_MODULES,
  HOST_MODULES,
  findEscapingImports,
  findHostModules,
  importsHostModule,
} from "./hostModuleScan";

const { vscode, electron, mcpSdk } = HOST_MODULES;

describe("importsHostModule detects every form, for every host module", () => {
  // Each host module must be caught in every syntactic form -- the matrix, not a
  // spot check, because the electron gap was precisely a missing row.
  const forms = (m: string): ReadonlyArray<readonly [string, string]> => [
    ["namespace import", `import * as x from "${m}";`],
    ["named import", `import { y } from "${m}";`],
    ["default import", `import z from "${m}";`],
    ["type-only import", `import type { T } from "${m}";`],
    ["single quotes", `import * as x from '${m}';`],
    ["bare side-effect import", `import "${m}";`],
    ["bare import after a semicolon", `const a = 1; import "${m}";`],
    ["require", `const x = require("${m}");`],
    ["dynamic import", `const x = await import("${m}");`],
    ["subpath import", `import { y } from "${m}/sub/path.js";`],
    ["subpath require", `require("${m}/sub/path.js")`],
  ];

  for (const m of ALL_HOST_MODULES) {
    describe(m, () => {
      it.each(forms(m))("flags a %s", (_label, source) => {
        expect(importsHostModule(source, m)).toBe(true);
      });
    });
  }

  // Accept cases matter as much: a detector returning true unconditionally would
  // pass every case above while making the guards meaningless.
  it.each([
    ["an unrelated module", 'import { join } from "node:path";'],
    [
      "a longer name sharing a prefix",
      'import x from "vscode-languageserver";',
    ],
    ["another prefix-sharing name", 'import x from "electron-store";'],
    ["a different scope", 'import x from "@other/sdk/server.js";'],
    ["a substring in an identifier", "const electronLike = 1;"],
    ["a mention in prose", "// we deliberately do not import electron here"],
    ["an empty file", ""],
  ])("does not flag %s", (_label, source) => {
    expect(findHostModules(source)).toEqual([]);
  });

  it("distinguishes which host module was found", () => {
    expect(findHostModules(`import "${electron}";`)).toEqual([electron]);
    expect(findHostModules(`import "${vscode}";`)).toEqual([vscode]);
    expect(findHostModules(`import x from "${mcpSdk}/server/mcp.js";`)).toEqual(
      [mcpSdk],
    );
  });

  it("covers all three hosts, so a new host cannot be forgotten silently", () => {
    // If a fourth host arrives, this fails until HOST_MODULES learns about it.
    expect(ALL_HOST_MODULES).toEqual([vscode, electron, mcpSdk]);
  });
});

describe("findEscapingImports finds relative imports that leave the package", () => {
  const ROOT = "/repo/packages/mine";

  it.each([
    ["a sibling package", "/repo/packages/mine/src/a.ts", "../../other/src/b"],
    ["the packages dir itself", "/repo/packages/mine/src/a.ts", "../.."],
    ["further up still", "/repo/packages/mine/src/a.ts", "../../../x"],
    [
      "a sibling from a nested dir",
      "/repo/packages/mine/src/deep/nest/a.ts",
      "../../../../other/src/b",
    ],
  ])("flags %s", (_label, file, spec) => {
    const found = findEscapingImports(file, `import x from "${spec}";`, ROOT);
    expect(found).toEqual([spec]);
  });

  it.each([
    ["a sibling file", "/repo/packages/mine/src/a.ts", "./b"],
    ["a parent inside the package", "/repo/packages/mine/src/a.ts", "../b"],
    [
      "a deep relative path that stays inside",
      "/repo/packages/mine/src/deep/nest/a.ts",
      "../../b",
    ],
    ["the package root itself", "/repo/packages/mine/src/a.ts", ".."],
  ])("does not flag %s", (_label, file, spec) => {
    expect(findEscapingImports(file, `import x from "${spec}";`, ROOT)).toEqual(
      [],
    );
  });

  it("is depth-aware, not a ../../ string match", () => {
    // The same specifier escapes from one depth and not from another -- which is why
    // this resolves paths instead of matching on "../../".
    const spec = "../../b";
    expect(
      findEscapingImports(
        "/repo/packages/mine/src/a.ts",
        `import x from "${spec}";`,
        ROOT,
      ),
    ).toEqual([spec]);
    expect(
      findEscapingImports(
        "/repo/packages/mine/src/deep/nest/a.ts",
        `import x from "${spec}";`,
        ROOT,
      ),
    ).toEqual([]);
  });

  it("finds every import form, and bare specifiers are not relative", () => {
    const src = [
      'import a from "../../x/one";',
      'import "../../x/two";',
      'const c = require("../../x/three");',
      'const d = await import("../../x/four");',
      'import e from "@scope/pkg";',
      'import f from "node:path";',
    ].join("\n");
    expect(
      findEscapingImports("/repo/packages/mine/src/a.ts", src, ROOT).sort(),
    ).toEqual(["../../x/four", "../../x/one", "../../x/three", "../../x/two"]);
  });
});
