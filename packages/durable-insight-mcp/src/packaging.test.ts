/**
 * Guards that a customer can actually install this package.
 *
 * THE FAILURE THIS PREVENTS:
 * This package is published (`"private": false`) and customers run it with
 * `npx -y @aws/durable-insight-mcp`. So every entry in `dependencies` must be
 * resolvable from the public registry. It briefly was not: `@aws/durable-insight-core`
 * is a `"private": true` workspace package that is never published, and listing it as
 * a runtime dependency made `npm install` fail with E404 for every user — reproduced
 * by packing this package and installing it outside the workspace.
 *
 * The same class of bug had just been found in the VS Code extension's isolated VSIX
 * packaging path, which is what prompted checking here.
 *
 * WHY IT IS A DEV DEPENDENCY:
 * esbuild inlines core into `dist/server.js`, so nothing resolves it at runtime — the
 * bundle carries core's code directly. That makes it a build input, not a runtime
 * dependency, and `devDependencies` is where build inputs belong. Anything genuinely
 * needed at runtime (a module marked `external` in the bundle) must stay in
 * `dependencies` instead.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PACKAGES_DIR = join(__dirname, "..", "..");

interface Manifest {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function read(path: string): Manifest | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Manifest;
  } catch {
    return undefined;
  }
}

/** Every workspace package by npm name. */
const workspacePackages = new Map<string, Manifest>();
for (const dir of readdirSync(PACKAGES_DIR)) {
  const m = read(join(PACKAGES_DIR, dir, "package.json"));
  if (m?.name) workspacePackages.set(m.name, m);
}

const self = read(join(__dirname, "..", "package.json")) as Manifest;

describe("published package is installable by a customer", () => {
  it("finds the workspace and this manifest", () => {
    // Guards against passing because it read nothing.
    expect(workspacePackages.size).toBeGreaterThan(5);
    expect(self.name).toBe("@aws/durable-insight-mcp");
  });

  it("is published, which is what makes the rule below apply", () => {
    expect(self.private ?? false).toBe(false);
  });

  it("declares no private workspace package as a runtime dependency", () => {
    const offenders = Object.keys(self.dependencies ?? {}).filter(
      (name) => workspacePackages.get(name)?.private === true,
    );
    // A private workspace package is never published, so npm cannot resolve it for a
    // customer: `npx` fails with E404 before the server ever starts.
    expect(offenders).toEqual([]);
  });

  it("keeps the bundled core as a dev dependency", () => {
    // Not merely absent from `dependencies` -- present where a build input belongs, so
    // the build cannot silently lose it either.
    expect(Object.keys(self.devDependencies ?? {})).toContain(
      "@aws/durable-insight-core",
    );
  });
});
