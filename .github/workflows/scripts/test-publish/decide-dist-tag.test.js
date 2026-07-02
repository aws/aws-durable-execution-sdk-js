// @ts-check
//
// Unit tests for decide-dist-tag.js. Run locally with:
//   node --test .github/workflows/scripts/test-publish/*.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSemver,
  compareSemver,
  isPrerelease,
  decide,
  fromPackument,
} from "./decide-dist-tag.js";

test("parseSemver: parses core, prerelease, ignores build metadata", () => {
  assert.deepEqual(parseSemver("1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: [],
  });
  assert.deepEqual(parseSemver("2.0.0-alpha.1"), {
    major: 2,
    minor: 0,
    patch: 0,
    prerelease: ["alpha", "1"],
  });
  assert.deepEqual(parseSemver("1.0.0-rc.2+build.7").prerelease, ["rc", "2"]);
  assert.throws(() => parseSemver("not.a.version"));
});

test("compareSemver: numeric core ordering (not string ordering)", () => {
  assert.equal(compareSemver("1.10.0", "1.9.0"), 1); // 10 > 9, the classic trap
  assert.equal(compareSemver("2.0.0", "1.9.9"), 1);
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
});

test("compareSemver: a prerelease is lower than its release", () => {
  assert.equal(compareSemver("2.0.0-beta.1", "2.0.0"), -1);
  assert.equal(compareSemver("2.0.0", "2.0.0-beta.1"), 1);
});

test("compareSemver: higher core beats prerelease status", () => {
  assert.equal(compareSemver("3.0.0-alpha.1", "2.0.0"), 1);
  assert.equal(compareSemver("2.1.0-beta.1", "2.0.0"), 1);
});

test("compareSemver: prerelease identifier precedence (spec §11)", () => {
  assert.equal(compareSemver("1.0.0-alpha", "1.0.0-alpha.1"), -1); // fewer ids = lower
  assert.equal(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1); // numeric < alnum
  assert.equal(compareSemver("1.0.0-alpha.beta", "1.0.0-beta"), -1); // lexical
  assert.equal(compareSemver("1.0.0-beta.2", "1.0.0-beta.11"), -1); // numeric compare
});

test("isPrerelease", () => {
  assert.equal(isPrerelease("1.0.0"), false);
  assert.equal(isPrerelease("1.0.0-rc.1"), true);
});

test("decide: first publish (no latest yet)", () => {
  assert.equal(decide("1.0.0", null, []), "latest");
  assert.equal(decide("1.0.0-rc.1", null, []), "beta");
});

test("decide: already-published version is skipped (idempotent)", () => {
  assert.equal(decide("1.1.1", "2.0.0", ["1.0.0", "1.1.1", "2.0.0"]), "skip");
});

test("decide: stable forward release moves latest", () => {
  assert.equal(decide("2.0.0", "1.9.0", ["1.9.0"]), "latest");
  assert.equal(decide("3.0.0", "2.5.0", ["2.5.0"]), "latest"); // new higher major
});

test("decide: stable backport to older line -> v<major>, never latest", () => {
  // v2 is latest; shipping v1.1.9 must NOT move latest.
  assert.equal(decide("1.1.9", "2.0.0", ["2.0.0"]), "v1");
});

test("decide: prerelease above latest -> beta", () => {
  assert.equal(decide("3.0.0-beta.1", "2.0.0", ["2.0.0"]), "beta");
  assert.equal(decide("2.1.0-alpha.1", "2.0.0", ["2.0.0"]), "beta");
});

test("decide: prerelease at/below latest -> reject (no old-line betas)", () => {
  // v2 is latest; a v1 beta is not allowed.
  assert.equal(decide("1.5.0-beta.1", "2.0.0", ["2.0.0"]), "reject");
  // a beta of an already-released version is also rejected.
  assert.equal(decide("2.0.0-beta.1", "2.0.0", ["2.0.0"]), "reject");
});

test("fromPackument: empty input means brand-new package", () => {
  assert.deepEqual(fromPackument(""), { latest: null, versions: [] });
});

test("fromPackument: extracts latest and version keys", () => {
  const pk = JSON.stringify({
    "dist-tags": { latest: "2.0.0", beta: "3.0.0-beta.1" },
    versions: { "1.0.0": {}, "2.0.0": {}, "3.0.0-beta.1": {} },
  });
  assert.deepEqual(fromPackument(pk), {
    latest: "2.0.0",
    versions: ["1.0.0", "2.0.0", "3.0.0-beta.1"],
  });
});
