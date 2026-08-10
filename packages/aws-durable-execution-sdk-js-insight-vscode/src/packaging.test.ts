/**
 * Guards the isolated VSIX packaging path against a dependency it cannot install.
 *
 * THE FAILURE THIS PREVENTS:
 * `vscode-extension-release.yml` cannot run `vsce package` from inside the npm
 * workspace (vsce's dependency walk follows `../` into sibling packages and fails,
 * and npm hoists node-llama-cpp's native binary to the repo root while vsce needs a
 * self-contained directory). So it copies just this package to a temp directory and
 * runs a standalone `npm install --no-workspaces`.
 *
 * That install resolves from the public registry. The moment this package depends on
 * a `"private": true` workspace package -- as it now does, on
 * `@aws/durable-execution-sdk-js-insight-core` -- the install fails with E404 unless the workflow
 * stages that package first. It did not, and the extraction PR shipped that break
 * without noticing, because the workflow is `workflow_dispatch`-only: no pull request
 * ever runs it.
 *
 * This test is the cheap standing check. It does not perform an install (that would
 * download hundreds of megabytes of per-platform native binaries); it asserts the
 * INVARIANT that every private dependency is staged by the release workflow. Adding
 * another private workspace dependency without adding it to the workflow's staging
 * loop fails here, in ordinary CI, with an explanation.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PACKAGES_DIR = join(__dirname, "..", "..");
const WORKFLOW = join(
  __dirname,
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "vscode-extension-release.yml",
);

interface Manifest {
  name: string;
  private?: boolean;
  dependencies?: Record<string, string>;
}

function readManifest(dir: string): Manifest | undefined {
  try {
    return JSON.parse(
      readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf-8"),
    ) as Manifest;
  } catch {
    return undefined;
  }
}

/** Every workspace package, by npm name, with the directory it lives in. */
const workspacePackages = new Map<
  string,
  { dir: string; manifest: Manifest }
>();
for (const dir of readdirSync(PACKAGES_DIR)) {
  const manifest = readManifest(dir);
  if (manifest?.name) workspacePackages.set(manifest.name, { dir, manifest });
}

const self = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as Manifest;

/**
 * Dependencies of this package that are private workspace packages, and therefore
 * unresolvable from the public registry.
 */
const privateDeps = Object.keys(self.dependencies ?? {}).filter((name) => {
  const found = workspacePackages.get(name);
  return found?.manifest.private === true;
});

const workflow = readFileSync(WORKFLOW, "utf-8");

describe("isolated VSIX packaging can install every dependency", () => {
  it("finds the workspace and the release workflow", () => {
    // Guards against this test passing because it read nothing.
    expect(workspacePackages.size).toBeGreaterThan(5);
    expect(workflow).toContain("npm install --no-workspaces");
  });

  it("this package does depend on at least one private workspace package", () => {
    // If this ever becomes false the checks below are vacuous, and this file should
    // be revisited rather than left silently passing.
    expect(privateDeps.length).toBeGreaterThan(0);
  });

  it.each(privateDeps)(
    "%s is staged into the isolated copy before the standalone install",
    (name) => {
      const dir = workspacePackages.get(name)?.dir;
      expect(dir).toBeDefined();
      // The workflow packs by DIRECTORY name, then rewrites the dependency to the
      // resulting tarball. Both halves must be present.
      expect(workflow).toContain(dir as string);
      expect(workflow).toMatch(/npm pack --pack-destination/);
      expect(workflow).toMatch(/npm pkg set "dependencies\./);
    },
  );

  it("stages with a packed tarball rather than a directory spec", () => {
    // `file:<dir>` is link semantics: npm does not install the linked package's own
    // dependencies, so core's AWS SDK deps would be missing and esbuild would fail
    // to resolve them. This was verified by doing it the wrong way first.
    expect(workflow).toContain("npm pack");
    expect(workflow).not.toMatch(
      /npm pkg set "dependencies\.[^"]*=file:\.\.\//,
    );
  });
});
