import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { minVersion, satisfies, validRange } from "semver";

/**
 * Regression guard for https://github.com/aws/aws-durable-execution-sdk-js/issues/674.
 *
 * The testing SDK declares a peer dependency on the core SDK
 * (`@aws/durable-execution-sdk-js`). Inside this monorepo the two packages are
 * linked via npm workspaces, so the peer range is never actually resolved —
 * meaning a range that would fail a real `npm install` (e.g. `^1.0.1` while the
 * core SDK is `2.0.0`) passes CI unnoticed. That is exactly how the published
 * `1.1.1` shipped an incompatible `^1.0.1` peer range.
 *
 * This test reads both manifests off disk and asserts the core SDK's current
 * version actually satisfies the declared peer range, catching the drift
 * without needing to publish or install from the registry.
 */
describe("peer dependency compatibility with the core SDK", () => {
  const CORE_PKG_NAME = "@aws/durable-execution-sdk-js";

  const readPkg = (...segments: string[]): Record<string, unknown> =>
    JSON.parse(readFileSync(join(__dirname, ...segments), "utf-8")) as Record<
      string,
      unknown
    >;

  // src/__tests__ -> package root
  const testingPkg = readPkg("..", "..", "package.json");
  // sibling package in the monorepo
  const corePkg = readPkg(
    "..",
    "..",
    "..",
    "aws-durable-execution-sdk-js",
    "package.json",
  );

  const peerDeps = (testingPkg.peerDependencies ?? {}) as Record<
    string,
    string
  >;
  const peerRange = peerDeps[CORE_PKG_NAME];
  const coreVersion = corePkg.version as string;

  it("declares a peer dependency on the core SDK", () => {
    expect(peerRange).toBeDefined();
  });

  it("declares a valid semver range for the core SDK peer dependency", () => {
    expect(validRange(peerRange)).not.toBeNull();
  });

  it("accepts the core SDK's current version", () => {
    expect(coreVersion).toBeTruthy();
    // includePrerelease so alpha/beta core versions (e.g. 2.0.0-alpha.1) are
    // matched by ranges like ">=2.0.0" during pre-release development.
    expect(satisfies(coreVersion, peerRange, { includePrerelease: true })).toBe(
      true,
    );
  });
});

/**
 * Every package in this monorepo that declares a range on the core SDK is
 * checked here, not just the testing SDK, because the same blind spot applies to
 * all of them: workspace linking means no declared range is ever resolved
 * locally, so a range that would install an unusable core passes CI.
 *
 * A package that references `DurableInstrumentationPluginFactory` is bound to
 * the core's plugin factory contract, which core 3.0.0 introduced by replacing
 * the plugin instance contract. Such a package cannot work against any earlier
 * core major: the handler fails at initialization because that core expects an
 * instance where the plugin now supplies a factory. Its declared range must
 * therefore exclude every core major below the one built here. The contract
 * binding is derived from the sources rather than from a list in this file,
 * because a list is what gets left behind when the next plugin package is added.
 */
describe("declared core SDK ranges across the monorepo", () => {
  const CORE_PKG_NAME = "@aws/durable-execution-sdk-js";
  /** Naming this type means the package consumes the factory contract. */
  const FACTORY_CONTRACT_MARKER = "DurableInstrumentationPluginFactory";
  /**
   * Ranges that only ever resolve inside this monorepo. npm satisfies them from
   * the workspace, they are never published as a compatibility claim, so there
   * is nothing for a version bump to leave stale.
   */
  const WORKSPACE_LOCAL = /^(\*|workspace:|file:|link:|portal:)/;
  const DEP_FIELDS = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const;

  // src/__tests__ -> package root -> packages/
  const packagesDir = join(__dirname, "..", "..", "..");
  const corePkgDir = join(packagesDir, "aws-durable-execution-sdk-js");

  const readManifest = (dir: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as Record<
      string,
      unknown
    >;

  const coreVersion = readManifest(corePkgDir).version as string;
  const coreMajor = minVersion(coreVersion)?.major;

  /** True when any non-test `.ts` file under `dir` contains `marker`. */
  const sourceContains = (dir: string, marker: string): boolean => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist") continue;
      // Test files are excluded: a test that names the type — this file does —
      // is not the package consuming the contract.
      if (entry === "__tests__") continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (sourceContains(path, marker)) return true;
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      if (/\.(test|spec)\.ts$/.test(entry)) continue;
      if (readFileSync(path, "utf-8").includes(marker)) return true;
    }
    return false;
  };

  interface DeclaredRange {
    pkgName: string;
    dir: string;
    field: string;
    range: string;
  }

  const declared: DeclaredRange[] = [];
  for (const entry of readdirSync(packagesDir).sort()) {
    const dir = join(packagesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    let manifest: Record<string, unknown>;
    try {
      manifest = readManifest(dir);
    } catch {
      continue;
    }
    const pkgName = (manifest.name as string) ?? entry;
    if (pkgName === CORE_PKG_NAME) continue;
    for (const field of DEP_FIELDS) {
      const deps = (manifest[field] ?? {}) as Record<string, string>;
      const range = deps[CORE_PKG_NAME];
      if (range === undefined) continue;
      declared.push({ pkgName, dir, field, range });
    }
  }

  it("finds the packages that declare a range on the core SDK", () => {
    // A run that finds nothing would pass every case below vacuously.
    expect(declared.length).toBeGreaterThan(0);
    expect(coreMajor).toBeDefined();
  });

  it.each(declared)(
    "$pkgName: $field range $range accepts the core SDK built here",
    ({ dir, range }) => {
      if (WORKSPACE_LOCAL.test(range)) return;
      expect(validRange(range)).not.toBeNull();
      expect(satisfies(coreVersion, range, { includePrerelease: true })).toBe(
        true,
      );

      // Packages bound to the factory contract must also exclude older majors.
      if (!sourceContains(join(dir, "src"), FACTORY_CONTRACT_MARKER)) return;
      const lowest = minVersion(range);
      expect(lowest).not.toBeNull();
      expect(lowest?.major).toBeGreaterThanOrEqual(coreMajor as number);
    },
  );
});
