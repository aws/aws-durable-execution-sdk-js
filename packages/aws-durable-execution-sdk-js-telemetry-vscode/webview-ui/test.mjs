// Runs the renderer's tests (src/**/*.test.tsx) with Node's built-in test runner.
//
// The renderer has no test framework of its own, and the extension's Jest
// config ignores this folder. esbuild already builds the renderer, so it also
// bundles each test file for Node, with the same JSX settings and with CSS
// imports dropped. `node --test` then runs the bundles.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import esbuild from "esbuild";

const tests = readdirSync("src", { recursive: true })
  .filter((f) => /\.test\.tsx?$/.test(f))
  .map((f) => join("src", f));
if (tests.length === 0) {
  console.error("No renderer tests found under src/.");
  process.exit(1);
}

const outdir = mkdtempSync(join(tmpdir(), "webview-ui-tests-"));
try {
  await esbuild.build({
    entryPoints: tests,
    bundle: true,
    platform: "node",
    format: "cjs",
    outdir,
    outExtension: { ".js": ".cjs" },
    jsx: "automatic",
    loader: { ".css": "empty" },
    logLevel: "warning",
  });
  const bundles = tests.map((t) =>
    join(outdir, basename(t).replace(/\.tsx?$/, ".cjs")),
  );
  const run = spawnSync(process.execPath, ["--test", ...bundles], {
    stdio: "inherit",
  });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
