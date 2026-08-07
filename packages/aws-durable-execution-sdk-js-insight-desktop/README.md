# Workflow Insight Explorer — Desktop

The Workflow Insight Explorer as a standalone desktop app, for people who want it
without running VS Code.

This package is a **host adapter, not a second product**. The UI is the
extension's React bundle, and every behavior behind it — query generation, the
agentic loop, read-only enforcement, drill-down, SQS tailing — comes from
`ExplorerSession` in
[`aws-durable-execution-sdk-js-insight-vscode`](../aws-durable-execution-sdk-js-insight-vscode).
There is no forked copy of that logic here, so the two hosts cannot drift.

## How the two hosts fit together

```
             ┌──────────────────────────────────────────┐
             │  webview-ui  (one React bundle)          │
             │  outbound via hostBridge.ts,             │
             │  inbound via window "message" events     │
             └───────────────┬──────────────────────────┘
                             │  the same message protocol
             ┌───────────────▼──────────────────────────┐
             │  ExplorerSession   (no host in it)       │
             │  + configCore / settingsKeys / llm       │
             └───────────────┬──────────────────────────┘
                             │  HostPort
              ┌──────────────┴───────────────┐
              ▼                              ▼
      extension.ts (VS Code)          main.ts + host.ts (Electron)
      webview panel, settings,        insight:// window, JSON store,
      showSaveDialog, Copilot         showSaveDialog
```

`HostPort` (see `../aws-durable-execution-sdk-js-insight-vscode/src/hostPort.ts`)
is the whole contract: post a message, read config, write settings, save a file,
show an info message, read/write saved queries. Adding a feature almost never
means touching this package.

## Running it

The desktop app does not build the UI — it loads the extension's `media/` bundle,
so build that first:

```bash
# once, from the repo root
npm ci

# build the shared webview bundle (writes insight-vscode/media/)
npm run build -w packages/aws-durable-execution-sdk-js-insight-vscode

# then run the desktop app
npm start -w packages/aws-durable-execution-sdk-js-insight-desktop
```

`npm start` runs `esbuild.mjs` and launches Electron. Use `node esbuild.mjs --watch`
in one terminal and `npx electron .` in another for an edit/reload loop.

## Configuration

Settings live in `insight-settings.json` in Electron's per-user data directory
(`~/Library/Application Support/Workflow Insight Explorer` on macOS,
`%APPDATA%` on Windows, `~/.config` on Linux). Saved queries live alongside it in
`insight-favorites.json`.

The keys are exactly the extension's `workflowInsight.*` settings minus the
prefix, and they are read back through the same `normalizeConfig`, so a value
means the same thing in both hosts. `settingsKeys.ts` is the shared list and
`settingsKeys.test.ts` asserts it still matches the extension's manifest.

AWS credentials are **not** stored here. They come from the standard SDK provider
chain — environment, `~/.aws/credentials`, SSO — honoring the `awsProfile`
setting, same as the extension.

## Differences from the VS Code extension

All of these are consequences of what the host can offer, and each is reported to
the UI as a capability so it never presents an option that cannot work — see
`hostCapabilities.ts`.

|                            | VS Code                                                                                  | Desktop                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Copilot LLM provider**   | Available (`vscode.lm`)                                                                  | Not available — the API only exists in the extension host. The option is hidden, and a stored `llmProvider: "copilot"` is narrowed to Bedrock when config is read, so Settings and query behavior always agree. |
| **On-device LLM provider** | Available — the VSIX ships `node-llama-cpp` (`.vscodeignore` deliberately un-ignores it) | Available in a dev checkout, absent from a packaged app. See below.                                                                                                                                             |
| **Naming a saved query**   | Prompts with `showInputBox`                                                              | Saved automatically under the truncated query text. Electron has no native single-line input dialog, and `HostPort.promptForText` is optional, so the session falls back to the label it would have pre-filled. |

Everything else — every destination, every query mode, charts, export,
drill-down, the SQS live view — is the same code.

### Why the on-device provider is dev-only here

`node-llama-cpp` is a native module loaded by dynamic import. It stays external in
`esbuild.mjs` (a native addon cannot be bundled), and `electron-builder`'s `files`
list is `dist/**/*` plus `package.json` — no `node_modules`. A packaged app
therefore has nothing to resolve it from.

Rather than hardcode the capability off for this host, `isLocalLlmAvailable()`
checks whether the module actually resolves. That answer is truthful in all three
builds: the VSIX ships it, a dev checkout finds it hoisted in the workspace root,
and a packaged app does not — so the option simply is not offered there. The
alternative failure mode, where it works under `npm start` and silently breaks
after packaging, cannot produce a broken affordance.

Making it work when packaged means declaring `node-llama-cpp` as a real dependency
of this package, adding it to `files`, and rebuilding the native addon against
Electron's ABI (`electron-rebuild`) per target arch. That is a deliberate
follow-up, not an oversight.

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webviewTag: false`. The renderer has no Node access; the preload script
  exposes exactly one function plus an inbound message relay.
- Assets are served from a private `insight://` scheme registered as standard and
  secure. Nothing remote is ever loaded, and `will-navigate` /
  `setWindowOpenHandler` deny navigation and popups (genuine `https://` links are
  handed to the OS browser).
- Per-load nonce CSP with `default-src 'none'`; scripts run only under that
  nonce.
- Every IPC message is checked to come from this window's own `webContents` and
  main frame before it can reach the session, so an embedded frame cannot drive
  AWS calls or the filesystem.
- The `insight://` static server resolves paths through `resolveAssetPath`, which
  strips leading separators _before_ normalizing — normalizing a `/`-prefixed
  path collapses `..` against the filesystem root and silently discards the
  traversal. See `assetPath.test.ts`, which covers that case explicitly.
- Settings are merged key-by-key against the shared allowlist rather than
  replacing the file with the renderer's object, so unknown and inherited names
  (`__proto__`) are never persisted.

## Packaging

`electron-builder` config lives in `package.json`. The extension's `media/`
directory is copied in as an `extraResources` entry, which is what
`app.isPackaged` switches to at runtime.

```bash
npm run build -w packages/aws-durable-execution-sdk-js-insight-vscode
npx electron-builder --mac --publish never
```

Artifacts would be **unsigned**: macOS shows an "unidentified developer" warning
on first launch (right-click → Open). Signing and notarization need an Apple
Developer ID certificate, so no release job is wired up yet — this is a
build-and-run-locally package for now.
