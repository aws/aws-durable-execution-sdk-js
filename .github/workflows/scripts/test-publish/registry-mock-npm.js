#!/usr/bin/env node
// @ts-check
//
// Registry-aware mock `npm` for the test-npm-validation workflow (ES module).
// Simulates just enough of the registry to exercise iterate-publish-npm.sh
// without ever touching real npm.
//
// State lives in the JSON file at $MOCK_REGISTRY and looks like:
//   { "<pkg>": { "distTags": { "latest": "2.0.0", ... }, "versions": ["1.0.0", ...] } }
// Seed it before a test to model the "current" registry; the mock mutates it
// on publish so post-publish verification can read it back.
//
// Supported commands:
//   npm view <name> --json            -> packument { "dist-tags", "versions" }
//   npm view <name> dist-tags.<tag>   -> the version for that tag (or "")
//   npm publish ... --tag <tag>       -> records version + moves <tag> (cwd = pkg dir)
//
// Env toggles for negative tests:
//   MOCK_FAIL_PUBLISH=1  -> publish exits non-zero
//   MOCK_BREAK_VERIFY=1  -> publish records a wrong version for the tag
//   MOCK_VIEW_FAIL=1     -> `npm view` fails like a transient registry error
//                           (no E404), so the script aborts instead of guessing

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.NPM_LOG) {
  appendFileSync(process.env.NPM_LOG, JSON.stringify(args) + "\n");
}

const regPath = process.env.MOCK_REGISTRY;
const readReg = () => {
  if (!regPath || !existsSync(regPath)) return {};
  try {
    return JSON.parse(readFileSync(regPath, "utf8"));
  } catch {
    return {};
  }
};
const writeReg = (reg) => {
  if (regPath) writeFileSync(regPath, JSON.stringify(reg));
};

if (args[0] === "view") {
  if (process.env.MOCK_VIEW_FAIL === "1") {
    console.error("npm error code E500\nnpm error 500 Internal Server Error");
    process.exit(1);
  }
  const name = args[1];
  const reg = readReg();
  const entry = reg[name];

  if (!entry) {
    // Unknown package == never published.
    console.error(`npm error code E404\nnpm error 404 '${name}' is not in this registry.`);
    process.exit(1);
  }

  if (args.includes("--json")) {
    const versions = {};
    for (const v of entry.versions || []) versions[v] = {};
    console.log(JSON.stringify({ "dist-tags": entry.distTags || {}, versions }));
    process.exit(0);
  }

  const distTagArg = args.find((a) => a.startsWith("dist-tags."));
  if (distTagArg) {
    const tag = distTagArg.slice("dist-tags.".length);
    console.log((entry.distTags && entry.distTags[tag]) || "");
    process.exit(0);
  }
  process.exit(0);
}

if (args[0] === "publish") {
  if (process.env.MOCK_FAIL_PUBLISH === "1") {
    console.error("registry-mock-npm: simulated publish failure");
    process.exit(1);
  }
  const tagIdx = args.indexOf("--tag");
  const tag = tagIdx === -1 ? "latest" : args[tagIdx + 1];
  // `npm publish` runs with cwd set to the package directory.
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const reg = readReg();
  const entry = reg[pkg.name] || { distTags: {}, versions: [] };
  entry.distTags = entry.distTags || {};
  entry.versions = entry.versions || [];
  if (!entry.versions.includes(pkg.version)) entry.versions.push(pkg.version);
  entry.distTags[tag] =
    process.env.MOCK_BREAK_VERIFY === "1" ? "0.0.0-wrong" : pkg.version;
  reg[pkg.name] = entry;
  writeReg(reg);
  console.log(`+ ${pkg.name}@${pkg.version} (mock, tag=${tag})`);
  process.exit(0);
}

// Anything else is a no-op success.
process.exit(0);
