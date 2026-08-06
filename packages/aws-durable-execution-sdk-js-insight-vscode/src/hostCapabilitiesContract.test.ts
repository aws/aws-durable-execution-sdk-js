/**
 * Guards the one contract that spans both TypeScript projects.
 *
 * `HostCapabilities` is declared twice by necessity: the host side in
 * hostCapabilities.ts, the renderer side in webview-ui/src/types.ts, which is a
 * separate tsconfig project with its own build (the same reason the whole webview
 * message protocol is declared in both places). Nothing in the type system
 * connects them, and both ways of getting it wrong are silent:
 *
 *   Add a field host-side only  -> the renderer's interface lacks it, so every
 *                                  consumer silently sees `undefined`.
 *   Add a field renderer-side only -> no host ever sets it, and App.tsx's
 *                                  conservative default pins it false forever.
 *
 * Neither is a compile error, and a capability stuck at false fails *closed* —
 * a hidden feature nobody reports. So this compares the host-side shape, the
 * renderer's interface, and App.tsx's default literal, and requires all three to
 * name exactly the same fields.
 *
 * Modelled on settingsKeys.test.ts, which does the same job for the settings
 * keys shared with the extension manifest.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectCapabilities } from "./hostCapabilities";

const WEBVIEW_SRC = join(__dirname, "..", "webview-ui", "src");

function read(file: string): string {
  return readFileSync(join(WEBVIEW_SRC, file), "utf-8");
}

/**
 * Field names declared in `interface HostCapabilities { ... }`.
 *
 * Deliberately a source parse rather than an import: webview-ui is a separate
 * project (and jest's modulePathIgnorePatterns excludes it), so its modules are
 * not resolvable from here — but its text is.
 */
function rendererInterfaceFields(): string[] {
  const src = read("types.ts");
  const match = /export interface HostCapabilities \{([\s\S]*?)\n\}/.exec(src);
  if (!match)
    throw new Error("HostCapabilities interface not found in types.ts");
  return fieldNames(match[1]);
}

/** Keys of the `useState<HostCapabilities>({ ... })` default in App.tsx. */
function rendererDefaultKeys(): string[] {
  const src = read("App.tsx");
  const match =
    /useState<HostCapabilities>\(\{([\s\S]*?)\}\)/.exec(src) ??
    /useState<HostCapabilities>\(([\s\S]*?)\)/.exec(src);
  if (!match) {
    throw new Error("HostCapabilities useState default not found in App.tsx");
  }
  return fieldNames(match[1]);
}

/** `name: value` / `name: type;` pairs, ignoring comments. */
function fieldNames(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("*") && !line.startsWith("//"))
    .map((line) => /^([A-Za-z_][\w]*)\s*:/.exec(line)?.[1])
    .filter((name): name is string => !!name)
    .sort();
}

describe("HostCapabilities stays consistent across both projects", () => {
  const hostFields = Object.keys(detectCapabilities()).sort();

  it("the host reports at least one capability", () => {
    // A passing-but-vacuous version of this suite is the bug it exists to catch:
    // three empty sets compare equal.
    expect(hostFields.length).toBeGreaterThan(0);
  });

  it("the renderer's interface declares exactly the host's fields", () => {
    expect(rendererInterfaceFields()).toEqual(hostFields);
  });

  it("App.tsx's default covers exactly the host's fields", () => {
    // A field missing here is the silent "permanently false" case: the host
    // reports it, but the initial state has no entry and nothing in the type
    // system objects, because the object literal would be incomplete.
    expect(rendererDefaultKeys()).toEqual(hostFields);
  });

  it("parses real field names (guards the parsing itself)", () => {
    // If either regex silently matched nothing, the two tests above would
    // compare empty arrays and pass. Assert a known field is actually seen.
    expect(rendererInterfaceFields()).toContain("copilot");
    expect(rendererDefaultKeys()).toContain("copilot");
    expect(hostFields).toContain("copilot");
  });

  it("ignores doc comments when collecting fields", () => {
    // The renderer interface documents every field, so a parser that treated
    // comment lines as fields would report extras and fail confusingly.
    expect(
      fieldNames("  /** doc */\n  * continued\n  // note\n  a: boolean;"),
    ).toEqual(["a"]);
  });
});
