/**
 * Self-tests for the boundary detector. These are the "guards the guard" cases:
 * without them, a regression in `importsVsCode` would make every host-purity test
 * in the repository pass vacuously.
 *
 * Note what these do NOT do: write a fixture file to disk. An earlier version
 * wrote `src/__vscode_guard_fixture__.ts`, read it straight back, and asserted on
 * the string — a round-trip that added no coverage over calling the detector
 * directly, while adding real failure modes. The path was not gitignored, and a
 * hard-killed run left a file behind that the next run's enumeration would pick up,
 * failing with a misleading "does not import the vscode API" against a filename
 * nobody wrote. Strings in, boolean out.
 */
import { importsVsCode } from "./vscodeImportScan";

describe("importsVsCode detects every form of reaching the VS Code API", () => {
  it.each([
    ["namespace import", 'import * as vscode from "vscode";'],
    ["named import", 'import { window } from "vscode";'],
    ["default-ish import", 'import vscode from "vscode";'],
    ["single quotes", "import * as vscode from 'vscode';"],
    ["bare side-effect import", 'import "vscode";'],
    ["bare import after a semicolon", 'const a = 1; import "vscode";'],
    ["require", 'const vscode = require("vscode");'],
    ["require with spaces", 'require ( "vscode" )'],
    ["dynamic import", 'const vscode = await import("vscode");'],
    ["dynamic import with spaces", 'await import ( "vscode" )'],
    ["type-only import", 'import type { Uri } from "vscode";'],
  ])("flags a %s", (_label, source) => {
    expect(importsVsCode(source)).toBe(true);
  });

  // The accept cases matter as much: a detector that returned true unconditionally
  // would pass every test above while making the purity guards meaningless.
  it.each([
    ["an unrelated module", 'import { join } from "node:path";'],
    ["a similarly named module", 'import x from "vscode-languageserver";'],
    ["a substring in an identifier", "const vscodeLike = 1;"],
    ["a mention in prose", "// we deliberately do not import vscode here"],
    ["an empty file", ""],
    [
      "a module whose name merely contains it",
      'import y from "my-vscode-utils";',
    ],
  ])("does not flag %s", (_label, source) => {
    expect(importsVsCode(source)).toBe(false);
  });
});
