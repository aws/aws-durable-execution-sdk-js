import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the shape of the SERVICE_PREFIX table, because three of the entries added in one
 * commit were DEAD — keyed on a package name that does not exist, so the real suffix fell
 * through to an invalid IAM prefix and the entry looked like protection that wasn't there.
 * `route53-domains` was the live one (the package is `client-route-53-domains`); `waf-v2`
 * and `step-functions` were dead but harmless.
 *
 * Asserted structurally rather than against the registry: a test must not depend on the
 * network. The rules below are the ones that were actually violated.
 */
describe("SERVICE_PREFIX entries are well-formed", () => {
  const src = readFileSync(join(__dirname, "analyzePermissions.ts"), "utf-8");
  const table = src.slice(
    src.indexOf("const SERVICE_PREFIX"),
    src.indexOf("/** Fixes command"),
  );
  const entries = [
    ...table.matchAll(/^\s+"?([a-z0-9-]+)"?:\s*"([a-z0-9-]+)"/gm),
  ].map((m) => ({ pkg: m[1], prefix: m[2] }));

  it("has entries at all", () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it("contains no identity mappings", () => {
    // The table's contract is "where they differ". A key equal to its value does nothing
    // and invites the next reader to add one that silently won't fire.
    const identity = entries
      .filter((e) => e.pkg === e.prefix)
      .map((e) => e.pkg);
    expect(identity).toEqual([]);
  });

  /**
   * NOT TESTED HERE, deliberately: whether each key is a real package name.
   *
   * That is the mistake that actually happened — `route53-domains` when the package is
   * `route-53-domains` — but it cannot be detected offline. `secrets-manager` ->
   * `secretsmanager` (real) and `route53-domains` -> `route53domains` (fake) are
   * structurally identical; the only difference is whether the package exists. A
   * heuristic here would either miss the case or flag legitimate entries, and a test that
   * appears to check something it cannot is worse than no test.
   *
   * Validating keys against the registry belongs in a script run deliberately, next to
   * `regenerate-api-directory.mjs`, not in a unit test that must work without a network.
   */
  it("keys look like package suffixes", () => {
    // The weak form that IS checkable: lowercase, hyphen-separated, no scope prefix.
    for (const e of entries) {
      expect(e.pkg).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.pkg).not.toContain("@aws-sdk");
      expect(e.pkg).not.toContain("client-");
    }
  });

  it("maps every key to a plausible IAM prefix", () => {
    for (const e of entries) {
      expect(e.prefix).toMatch(/^[a-z0-9-]+$/);
      expect(e.prefix.length).toBeGreaterThan(1);
    }
  });
});
