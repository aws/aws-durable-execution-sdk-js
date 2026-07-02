import { readFileSync } from "node:fs";
import { join } from "node:path";
import { satisfies, validRange } from "semver";

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
