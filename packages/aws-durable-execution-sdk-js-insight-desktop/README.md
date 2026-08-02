# Workflow Insight — Desktop (standalone)

A standalone **Electron** app that runs the same Workflow Insight experience as
the VS Code extension, for customers who prefer not to work inside VS Code.

It **reuses**, rather than reimplements, the extension:

- **Renderer** = the extension's built webview bundle (`../aws-durable-execution-sdk-js-insight-vscode/media/webview.js|css` + Monaco workers), served over a privileged `insight://` scheme.
- **Host** = the extension's vscode-free modules (`functions`, `resources`, `awsSdkReflect`, …) imported verbatim, wired to Electron IPC + native dialogs.
- **Boundary** = the exact same webview message protocol (`OutboundMessage`/`InboundMessage`). The webview's `vscode.ts` is now environment-aware: in VS Code it uses `acquireVsCodeApi()`; here it uses `window.__insightHost` injected by the preload, and inbound messages arrive as normal `window` `message` events — so no webview component changed.

AWS credentials come from the standard SDK provider chain (env, `~/.aws`, SSO),
selectable by profile/region in Settings — identical to the extension.

## Status (PoC)

Wired: Functions list, function info, executions list + detail, stop/start
execution, the **AWS SDK method** browser (on-demand client reflection), open/
save `.dar`, export, settings/consent, and **AI generation**
(`generate`/`generateWorkflow`/`generateNodeCode`, routed to Bedrock/Copilot/
local server — same as the extension).

Not yet ported: **saved queries (favorites)** (`saveFavorite`/`deleteFavorite`),
**local on-device model management** (`listModels`/`downloadModel`), and
**live SQS queue tail** (`startListening`/`stopListening`). Those messages
currently no-op with a console warning only — no error is shown in the UI yet.

**Known gap in a packaged build**: the **AWS SDK method browser**'s on-demand
client reflection (`awsSdkReflect.ts`) lazily `npm install`s whichever
`@aws-sdk/client-*` package the user asks to browse if it isn't already on
disk. That works in the monorepo dev layout (a real npm project, `npm` on
PATH, writable `node_modules`); a packaged `.app`'s `Resources/app.asar` is
read-only and has no guarantee `npm` is on PATH, so browsing a client that
isn't already bundled will likely fail there. Not yet fixed — flagging so
it isn't a surprise.

Importing a Step Functions state machine (ASL) into a `.dar` workflow is
**one-way by design** — there is no `.dar` → ASL exporter, and none is
planned. See [`docs/dar-vs-asl.md`](../../docs/dar-vs-asl.md#import-is-one-way-by-design)
for why.

## Run it

```bash
# 1. Build the webview bundle the desktop app serves as its renderer:
cd ../aws-durable-execution-sdk-js-insight-vscode/webview-ui && npm run build

# 2. Build the desktop main/preload bundles:
cd ../../aws-durable-execution-sdk-js-insight-desktop && npm run build

# 3. Install Electron once. NOTE: the monorepo has a pre-existing, unrelated
#    peer-dependency conflict, so install with --legacy-peer-deps, or install it
#    isolated to this package.
npm install electron@^43 --legacy-peer-deps

# 4. Launch:
npm start        # (build + electron .)
```

`type-check` and `build` work **without** Electron installed (via a local
ambient type shim in `types/electron.d.ts`); only launching needs it.

## Package the app

```bash
# From this package directory. Defaults to the host platform/arch:
npm run package

# …or pick a target explicitly:
npm run package:mac        # dmg, arm64
npm run package:mac-x64    # dmg, x64
npm run package:win        # zip, x64
npm run package:linux      # AppImage, x64
```

`scripts/package-app.mjs` does everything in order, so this works from a clean
checkout:

1. builds the renderer (`webview-ui`, installing it first — it is a nested
   package outside the root workspaces glob) and asserts the output exists,
   because `build.extraResources` copies it and would otherwise ship an app with
   no UI;
2. builds `main`/`preload`;
3. installs the real runtime deps and copies them into this package's own
   `node_modules/`. `esbuild` and `typescript` are `require()`d at load time by
   deploy / agent / darTs / inferTypes — actual runtime dependencies, not build
   tools. In the monorepo they resolve via the hoisted workspace root; a packaged
   app has no such root. A plain `npm install` here does not help, since it
   resolves through the workspace and hoists to the root, hence the isolated
   prefix;
4. runs `electron-builder` for one target;
5. asserts only the requested architecture was produced.

**Why one arch per run:** `esbuild`'s native binary is per-platform, and step 3
pins it to the target with `npm --os/--cpu`. `build.<os>.target` deliberately does
not pin `arch`, because electron-builder's config takes precedence over the CLI —
listing both arches there makes a single run build both while only one arch's
binary was staged, so the other artifact ships a binary for the wrong
architecture. It installs fine and then fails every deploy at runtime, with
packaging still reporting success. Step 5 exists to catch exactly that.

Artifacts land in `release/`, **unsigned**. On macOS that means Gatekeeper shows
an "unidentified developer" warning on first launch (right-click → Open, or
System Settings → Privacy & Security). Acceptable for the preview; signing and
notarization need an Apple Developer ID certificate.

Releases run the same script — see `build-desktop-app` in
`.github/workflows/vscode-extension-release.yml`, which attaches one artifact per
platform to the same draft release as the extension. That job is
`continue-on-error` and is not a dependency of `verify-and-publish`, so a desktop
failure cannot block the extension release.

## Next steps toward a shippable product

1. **Extract a shared `-insight-core` package** so the extension and desktop app
   share host logic by dependency instead of cross-package relative imports.
2. **AI via Bedrock** (replace the VS Code language-model path).
3. **Code signing + notarization** for the macOS build (requires an Apple
   Developer ID certificate); Windows/Linux targets (`.exe`, AppImage); auto-update.
4. Externalize the AWS SDK from the main bundle to shrink it.
5. Credentials UX: profile picker + SSO login.
