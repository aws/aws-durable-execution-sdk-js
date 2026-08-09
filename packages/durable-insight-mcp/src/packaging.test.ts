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

/**
 * `"private": false` is a manifest flag. It permits publishing; it does not cause it.
 * The release script decides that, from a hard-coded list, and this package was missing
 * from it -- so `npx -y @aws/durable-insight-mcp` could not have worked no matter what
 * the manifest said. Every test above passed throughout, because none of them knew the
 * release pipeline existed.
 *
 * The invariant is deliberately keyed on the `@aws/` SCOPE rather than on
 * `private !== true`. Three packages in this workspace are non-private and are
 * correctly never published -- `cdk-bundling-integration-test`, `esm-integration-test`,
 * `lambda-runtime-detection-integration-test` -- so the broader rule would fail on
 * pre-existing, correct state. A scoped name is the actual signal of intent to publish:
 * nothing else can claim `@aws/`.
 */
describe("release pipeline actually publishes what claims to be published", () => {
  const PUBLISH_SCRIPT = join(
    __dirname,
    "..",
    "..",
    "..",
    ".github",
    "workflows",
    "iterate-publish-npm.sh",
  );
  const script = readFileSync(PUBLISH_SCRIPT, "utf-8");

  /** Directory names listed in the script's PACKAGES array. */
  const listedDirs = new Set(
    [...script.matchAll(/^\s*"packages\/([^"]+)"\s*$/gm)].map((m) => m[1]),
  );

  it("finds the publish list", () => {
    // Non-vacuity: a renamed script or a restructured array must fail loudly here
    // rather than silently making every assertion below trivially true.
    expect(listedDirs.size).toBeGreaterThan(3);
    expect(listedDirs).toContain("aws-durable-execution-sdk-js");
  });

  it("lists every publishable @aws/-scoped workspace package", () => {
    const missing: string[] = [];
    for (const dir of readdirSync(PACKAGES_DIR)) {
      const m = read(join(PACKAGES_DIR, dir, "package.json"));
      if (!m?.name || m.private === true) continue;
      if (!m.name.startsWith("@aws/")) continue;
      if (!listedDirs.has(dir)) missing.push(`${m.name} (packages/${dir})`);
    }
    // A package here is one a customer is told to install and cannot.
    expect(missing).toEqual([]);
  });

  it("lists this package specifically", () => {
    // Stated separately so the failure names this package rather than a set.
    expect(listedDirs).toContain("durable-insight-mcp");
  });
});
