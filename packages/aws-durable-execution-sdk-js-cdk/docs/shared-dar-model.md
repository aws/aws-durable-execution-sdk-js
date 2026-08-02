# Shared `.dar` model — design

> **Status: implemented.** All three phases below shipped in
> `@aws/durable-execution-sdk-js-visual-workflow-model` (primitives + identifiers,
> strategy spec, and the JSON Schema + `migrateDar`). The CDK and Studio import
> from it; the cross-package agreement test guards the re-export wiring.

## Problem

The `.dar` model is duplicated across two packages:

- **CDK** (`@aws/durable-execution-sdk-js-cdk`): a minimal, tolerant **read model**
  (`darModel.ts`) + `identifiers.ts` + `strategy.ts`, used by the code generator.
- **Studio** (`aws-durable-execution-sdk-js-insight-vscode/webview-ui`): a rich
  **authoring model** (`studioModel/model.ts` discriminated union + `createNode`,
  `parseWorkflow`, validation, layout) + `studioModel/strategy.ts`.

The only guard against drift today is a cross-package **agreement test**
(`identifierAgreement.test.ts`) that reaches into the extension source and
asserts `toIdentifier` + the reserved set match. That comment literally says
"until a shared `.dar` model package exists".

## Decision

**Share the primitives; keep the two representations.** The authoring model
(mutable union + layout + validation) and the codegen read-model (minimal,
tolerant) are legitimately different and should stay separate. We extract only
what must not drift into a new, dependency-free, browser-safe package:

- Package: **`@aws/durable-execution-sdk-js-visual-workflow-model`** at
  `packages/aws-durable-execution-sdk-js-visual-workflow-model`.
- Zero runtime deps; pure TS. Consumable by CDK `tsc`, the host esbuild, and the
  webview esbuild (browser platform) — so **no Node built-ins**.
- Built with `tsc` to `dist` (like the CDK package); `main`/`types` point at
  `dist`. Must build before its consumers.

### What moves into the shared package

- `DarNodeKind`, `DarPosition`, `DarEdge`, `ErrorBranch`, `DependencyMode`.
- `DAR_VERSION` constant.
- Identifiers: `toIdentifier`, `buildIdentifierMap`, `RESERVED_IDENTIFIERS`.
- Strategy spec: `RetryStrategySpec`, `StrategyKind`, `JitterKind`,
  `normalizeStrategy`, defaults.
- (Phase 3) A JSON Schema for the serialized `.dar` + `migrateDar(raw)` that
  upgrades older `darVersion`s to the latest before parsing.

### What stays per-package

- CDK `DarWorkflow`/`DarNode` read-model (index-signature tolerant) — now built
  on the shared kind/edge/errorBranch/position types.
- Studio `DarWorkflow`/`DarNode` authoring union + `createNode`/`parseWorkflow`/
  validation/layout — likewise built on the shared primitives.

## Phases

1. **Scaffold + identifiers/version/kinds.** Create the package, wire the build
   (workspace symlink via `npm install`, `tsc` → dist). Move identifiers +
   reserved set + `DAR_VERSION` + node-kind/edge/errorBranch/position types.
   Rewire CDK `identifiers.ts` and `darModel.ts` to import/re-export from shared;
   rewire Studio `model.ts`. Drop or repoint the agreement test. Verify all.
2. **Strategy.** Move the strategy spec + `normalizeStrategy` + defaults; rewire
   both `strategy.ts` copies to re-export; delete duplicated logic.
3. **Schema + migrations.** Add the JSON Schema + `migrateDar`; both packages'
   `parseWorkflow` run `migrateDar` first. Establishes `darVersion` migration.

## Risks / notes

- **Build order**: shared must be built before CDK/host/webview. Add to the
  relevant build scripts / CI order.
- **Browser safety**: webview bundles it at `platform: "browser"` — keep it free
  of Node built-ins and heavy deps.
- **Lockfile**: adding the workspace package requires a root `npm install` to
  create the `node_modules/@aws/durable-execution-sdk-js-visual-workflow-model` symlink.
- Ship built `dist` (not raw `.ts` via exports) to match the CDK consumption
  pattern the host esbuild already relies on.
