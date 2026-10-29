// Runs the renderer's tests (src/**/*.test.ts[x]) with Node's built-in test
// runner.
//
// The renderer has no test framework of its own, and the extension's Jest
// config ignores this folder. esbuild already builds the renderer, so it also
// bundles each test file for Node, with the same JSX settings and with CSS
// imports dropped. `node --test` then runs the bundles.
//
// `*.hook.test.ts` files test a state hook without a DOM: they are bundled
// with "react" replaced by src/testing/fakeReact.ts and ./hostBridge by
// src/testing/fakeHostBridge.ts.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import esbuild from "esbuild";

const tests = readdirSync("src", { recursive: true })
  .filter((f) => /\.test\.tsx?$/.test(f))
  .map((f) => join("src", f));
if (tests.length === 0) {
  console.error("No renderer tests found under src/.");
  process.exit(1);
}
const hookTests = tests.filter((t) => /\.hook\.test\.tsx?$/.test(t));
const plainTests = tests.filter((t) => !hookTests.includes(t));

const fakes = {
  name: "hook-test-fakes",
  setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({
      path: resolve("src/testing/fakeReact.ts"),
    }));
    build.onResolve({ filter: /(^|\/)hostBridge$/ }, () => ({
      path: resolve("src/testing/fakeHostBridge.ts"),
    }));
  },
};

const outdir = mkdtempSync(join(tmpdir(), "webview-ui-tests-"));
try {
  const common = {
    bundle: true,
    platform: "node",
    format: "cjs",
    // Keep each test's path under src/, so tests in subfolders keep distinct
    // output paths and are all found below.
    outbase: "src",
    outExtension: { ".js": ".cjs" },
    jsx: "automatic",
    loader: { ".css": "empty" },
    logLevel: "warning",
  };
  const bundles = [];
  for (const [entries, plugins, dir] of [
    [plainTests, [], join(outdir, "plain")],
    [hookTests, [fakes], join(outdir, "hook")],
  ]) {
    if (entries.length === 0) continue;
    await esbuild.build({
      ...common,
      entryPoints: entries,
      outdir: dir,
      plugins,
    });
    for (const t of entries) {
      bundles.push(
        join(dir, t.slice("src/".length).replace(/\.tsx?$/, ".cjs")),
      );
    }
  }
  // A bundle path that does not exist would be skipped silently.
  const missing = bundles.filter((b) => !existsSync(b));
  if (missing.length > 0) {
    console.error(`Test bundles not found: ${missing.join(", ")}`);
    process.exit(1);
  }
  const run = spawnSync(process.execPath, ["--test", ...bundles], {
    stdio: "inherit",
  });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
