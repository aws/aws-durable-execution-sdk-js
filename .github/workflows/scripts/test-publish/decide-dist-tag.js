#!/usr/bin/env node
// @ts-check
//
// Pure decision logic: which npm dist-tag (if any) a version should get, based
// on the package's CURRENT `latest` on the registry and its already-published
// versions. No I/O here — the caller passes registry state in as arguments, so
// the policy is trivially unit-testable.
//
// CLI usage:
//   node decide-dist-tag.js <version> [packumentJson]
//     packumentJson: the JSON from `npm view <name> --json` ("" if the package
//     has never been published). Prints exactly one decision token:
//       skip        version already published (idempotent re-run)
//       latest      publish to the `latest` tag
//       beta        publish to the `beta` tag
//       v<major>    publish to a release-line tag (backport; does NOT move latest)
//       reject      policy violation; the caller must abort
//
// Policy (per package; V = version being released, L = current `latest`):
//   no L yet (first publish):  V prerelease -> beta,  otherwise -> latest
//   V already published:       skip
//   V is a prerelease:         V > L -> beta      else -> reject (no old-line betas)
//   V is stable:               V > L -> latest    else -> v<major(V)> (backport)

/**
 * @param {string} v
 * @returns {{major:number,minor:number,patch:number,prerelease:string[]}}
 */
export function parseSemver(v) {
  // Drop build metadata (everything after the first '+'); it has no precedence.
  const core = String(v).split("+")[0];
  const m = core.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!m) throw new Error(`invalid semver version: ${v}`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

/** @param {string} id */
const isNumericId = (id) => /^\d+$/.test(id);

/**
 * Compare two semver versions per the spec (incl. prerelease precedence).
 * @returns {-1|0|1}
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (const k of /** @type {const} */ (["major", "minor", "patch"])) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  // Core versions equal: a version WITH a prerelease is lower than one without.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const n = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < n; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai === undefined) return -1; // fewer identifiers => lower precedence
    if (bi === undefined) return 1;
    const an = isNumericId(ai);
    const bn = isNumericId(bi);
    if (an && bn) {
      if (ai !== bi) return Number(ai) < Number(bi) ? -1 : 1;
    } else if (an) {
      return -1; // numeric identifiers are lower than alphanumeric
    } else if (bn) {
      return 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1; // lexical ASCII order
    }
  }
  return 0;
}

/** @param {string} v */
export function isPrerelease(v) {
  return parseSemver(v).prerelease.length > 0;
}

/**
 * Decide the dist-tag (or special action) for a version.
 * @param {string} version       version being released
 * @param {string|null} latest   current `latest` on the registry, or null/"" if none
 * @param {string[]} versions    all already-published versions
 * @returns {"skip"|"latest"|"beta"|"reject"|`v${number}`}
 */
export function decide(version, latest, versions = []) {
  if (versions.includes(version)) return "skip";
  if (!latest) return isPrerelease(version) ? "beta" : "latest";

  const cmp = compareSemver(version, latest);
  if (isPrerelease(version)) {
    // Only prereleases ABOVE the current latest get the shared `beta` channel.
    return cmp > 0 ? "beta" : "reject";
  }
  // Stable: only a version greater than current latest may move `latest`.
  // Anything lower is a backport to an older line -> release-line tag.
  return cmp > 0 ? "latest" : `v${parseSemver(version).major}`;
}

/**
 * Extract { latest, versions } from `npm view <name> --json` output.
 * @param {string} packumentJson
 */
export function fromPackument(packumentJson) {
  if (!packumentJson || !packumentJson.trim()) {
    return { latest: null, versions: /** @type {string[]} */ ([]) };
  }
  const pk = JSON.parse(packumentJson);
  const distTags = pk["dist-tags"] || {};
  let versions = [];
  if (Array.isArray(pk.versions)) versions = pk.versions;
  else if (pk.versions && typeof pk.versions === "object")
    versions = Object.keys(pk.versions);
  else if (typeof pk.versions === "string") versions = [pk.versions];
  return { latest: distTags.latest || null, versions };
}

// --- CLI ---
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  const packumentJson = process.argv[3] || "";
  if (!version) {
    console.error("usage: decide-dist-tag.js <version> [packumentJson]");
    process.exit(2);
  }
  const { latest, versions } = fromPackument(packumentJson);
  process.stdout.write(decide(version, latest, versions));
}
