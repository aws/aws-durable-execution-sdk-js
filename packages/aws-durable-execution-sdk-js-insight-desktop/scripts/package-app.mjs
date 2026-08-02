#!/usr/bin/env node
/**
 * Packages the desktop app reproducibly from a clean checkout.
 *
 * This replaces the hand-run sequence the README used to document, which was the
 * reason a clean checkout could not produce the app. Three things have to happen
 * in order, and none of them were sequenced:
 *
 *  1. **Build the renderer.** `build.extraResources` copies
 *     `../aws-durable-execution-sdk-js-insight-vscode/media`, which is produced by
 *     the vscode package's `webview-ui` build. Nothing guaranteed it existed, so
 *     packaging could silently ship an app with a stale or missing UI.
 *
 *  2. **Build main/preload.**
 *
 *  3. **Put the real runtime deps in THIS package's own `node_modules/`.**
 *     `esbuild` and `typescript` are `require()`d at load time by deploy / agent /
 *     darTs / inferTypes — runtime dependencies, not build tools. In the monorepo
 *     they resolve via the hoisted workspace root; a packaged app has no such
 *     root, so they must physically exist here. A plain `npm install` in this
 *     directory does NOT achieve that: it resolves through the npm workspace and
 *     hoists to the root. So they are installed into an isolated prefix and copied.
 *
 * `esbuild`'s native binary is per-platform (`@esbuild/<os>-<arch>`), so the
 * install is pinned to the TARGET platform via `--os`/`--cpu` rather than
 * inheriting the host's. Shipping the wrong arch's binary would break every
 * deploy at runtime while packaging still looked fine — which is why the x64
 * target had previously been removed from `build.mac.target` rather than fixed.
 *
 * Usage:
 *   node scripts/package-app.mjs                          # host platform
 *   node scripts/package-app.mjs --target mac --arch arm64
 *   node scripts/package-app.mjs --target linux --arch x64
 *
 * Produces an UNSIGNED artifact under `release/`. That is deliberate for the
 * preview: macOS shows an "unidentified developer" warning on first launch
 * (right-click -> Open). Signing/notarization needs an Apple Developer ID.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const repoRoot = resolve(pkgRoot, "..", "..");
const vscodePkg = resolve(
  repoRoot,
  "packages",
  "aws-durable-execution-sdk-js-insight-vscode",
);

/** electron-builder's platform flag, plus the matching npm/esbuild os names. */
const TARGETS = {
  mac: { builderFlag: "--mac", npmOs: "darwin", esbuildOs: "darwin" },
  win: { builderFlag: "--win", npmOs: "win32", esbuildOs: "win32" },
  linux: { builderFlag: "--linux", npmOs: "linux", esbuildOs: "linux" },
};

function parseArgs(argv) {
  const out = { target: null, arch: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target") out.target = argv[++i];
    else if (argv[i] === "--arch") out.arch = argv[++i];
  }
  out.target ??=
    process.platform === "darwin"
      ? "mac"
      : process.platform === "win32"
        ? "win"
        : "linux";
  out.arch ??= process.arch === "arm64" ? "arm64" : "x64";
  if (!TARGETS[out.target]) {
    throw new Error(
      `unknown --target "${out.target}" (expected mac, win or linux)`,
    );
  }
  if (out.arch !== "arm64" && out.arch !== "x64") {
    throw new Error(`unknown --arch "${out.arch}" (expected arm64 or x64)`);
  }
  return out;
}

function run(cmd, args, cwd) {
  process.stderr.write(`\n$ ${cmd} ${args.join(" ")}\n`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function main() {
  const { target, arch } = parseArgs(process.argv.slice(2));
  const t = TARGETS[target];
  process.stderr.write(`Packaging desktop app for ${target}/${arch}\n`);

  // 1. Renderer. webview-ui is nested outside the root workspaces glob, so it
  //    needs its own install before it can build.
  const webviewUi = join(vscodePkg, "webview-ui");
  if (!existsSync(join(webviewUi, "node_modules"))) {
    run(npm, ["ci"], webviewUi);
  }
  run(npm, ["run", "build"], webviewUi);
  const media = join(vscodePkg, "media");
  if (!existsSync(join(media, "webview.js"))) {
    throw new Error(
      `renderer build did not produce ${join(media, "webview.js")} — ` +
        `extraResources would ship an app with no UI`,
    );
  }

  // 2. main/preload.
  run("node", ["esbuild.mjs"], pkgRoot);

  // 3. Runtime deps, pinned to the TARGET platform.
  const runtimeDir = join(pkgRoot, ".runtime");
  rmSync(runtimeDir, { recursive: true, force: true });
  const esbuildNative = `@esbuild/${t.esbuildOs}-${arch}`;
  run(
    npm,
    [
      "install",
      "esbuild@0.24.2",
      "typescript@5.8.3",
      "jsonc-parser@3.3.1",
      esbuildNative,
      "--prefix",
      ".runtime",
      "--os",
      t.npmOs,
      "--cpu",
      arch,
      "--legacy-peer-deps",
      "--no-save",
    ],
    pkgRoot,
  );

  const nodeModules = join(pkgRoot, "node_modules");
  rmSync(nodeModules, { recursive: true, force: true });
  mkdirSync(join(nodeModules, "@esbuild"), { recursive: true });
  const from = join(runtimeDir, "node_modules");
  for (const dep of ["esbuild", "typescript", "jsonc-parser"]) {
    cpSync(join(from, dep), join(nodeModules, dep), { recursive: true });
  }
  const nativeName = `${t.esbuildOs}-${arch}`;
  const nativeFrom = join(from, "@esbuild", nativeName);
  if (!existsSync(nativeFrom)) {
    throw new Error(
      `${esbuildNative} was not installed — packaging would ship an esbuild ` +
        `with no usable binary for ${target}/${arch}, breaking deploy at runtime`,
    );
  }
  cpSync(nativeFrom, join(nodeModules, "@esbuild", nativeName), {
    recursive: true,
  });

  // 4. Package. Prefers the electron-builder from the workspace if present, else
  //    fetches the pinned version, so this works without it in the lockfile.
  const rootBuilder = join(
    repoRoot,
    "node_modules",
    "electron-builder",
    "out",
    "cli",
    "cli.js",
  );
  const [cmd, pre] = existsSync(rootBuilder)
    ? ["node", [rootBuilder]]
    : ["npx", ["--yes", "electron-builder@26.15.3"]];
  run(cmd, [...pre, t.builderFlag, `--${arch}`, "--publish", "never"], pkgRoot);

  // 5. Prove the packaged app got the RIGHT native binary. `build.<os>.target`
  //    deliberately does not pin an arch, because electron-builder's config wins
  //    over the CLI: listing both arches there made a single run build both while
  //    only one arch's binary had been copied in, so the other artifact shipped a
  //    binary for the wrong architecture and would fail every deploy at runtime —
  //    with packaging still reporting success. This asserts that can't recur.
  const built = readdirSync(join(pkgRoot, "release")).filter((f) =>
    /\.(dmg|AppImage|zip)$/.test(f),
  );
  if (built.length === 0) {
    throw new Error("electron-builder produced no installer in release/");
  }
  // Assert on the STAGED NATIVE BINARY, not on installer filenames.
  //
  // The filename check this replaces was vacuous for half the matrix: on an x64 leg
  // it looked for "arm64" in the names, and electron-builder omits the arch from
  // x64 filenames entirely — so it always passed and the advertised guarantee came
  // solely from the --os/--cpu pin earlier. Checking that exactly the requested
  // esbuild native package is present, and no other, tests the thing that actually
  // breaks: a mismatched binary fails every deploy at runtime while packaging still
  // reports success.
  const stagedEsbuild = join(runtimeDir, "node_modules", "@esbuild");
  if (!existsSync(stagedEsbuild)) {
    throw new Error(
      `no @esbuild native package was staged at ${stagedEsbuild}; the packaged app ` +
        `would fail to load esbuild at runtime.`,
    );
  }
  const stagedArches = readdirSync(stagedEsbuild);
  const expected = `${t.esbuildOs}-${arch}`;
  if (!stagedArches.includes(expected)) {
    throw new Error(
      `staged esbuild binaries are [${stagedArches.join(", ")}] but this build ` +
        `targets ${expected}.`,
    );
  }
  const extra = stagedArches.filter((a) => a !== expected);
  if (extra.length > 0) {
    throw new Error(
      `staged esbuild binaries for unrequested platforms (${extra.join(", ")}) ` +
        `alongside ${expected}. Check that build.${target}.target does not pin ` +
        `"arch" — electron-builder's config beats the CLI, and one run would build ` +
        `both arches with only one arch's binary staged.`,
    );
  }
  process.stderr.write(`\nArtifacts: ${built.join(", ")}\n`);

  process.stderr.write(
    `\nDone. Unsigned artifact(s) in ${join(pkgRoot, "release")}\n`,
  );
}

main();
