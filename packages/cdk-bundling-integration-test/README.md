# CDK Bundling Integration Test

This package reproduces the AWS CDK `NodejsFunction` bundling path
that downstream consumers hit at Lambda cold start. It guards against
regressions where the SDK's `dist/index.mjs` contains top-level
`import.meta.url` references that crash module init when the .mjs is
re-bundled into CJS by esbuild.

## Background

The 1.1.3-1.1.5 SDK regressions ([#539], [#546], [#562]) all manifest
as `TypeError: fileURLToPath(undefined)` at Lambda cold start. The
trigger is `@rollup/plugin-esm-shim` injecting top-level constructs
that reference `import.meta.url` into `dist/index.mjs` whenever any
source file uses bare `__filename` or `__dirname`. When esbuild
re-bundles that .mjs into CJS for Lambda, `import.meta` is undefined
in the CJS context, so any literal `import.meta.url` survives into the
output and crashes when evaluated.

Note: `mainFields: ['main', 'module']` does NOT save consumers from
this. The SDK's `package.json` `exports` map takes precedence, so
esbuild still resolves the SDK to `dist/index.mjs` via the `import`
condition.

## Usage

```bash
npm run test -w packages/cdk-bundling-integration-test
```

## What it does

1. Builds a CDK Lambda bundling layout in a temp dir:
   - A `bundleRoot` containing a TypeScript handler that imports the
     SDK, with the SDK symlinked into its `node_modules`.
   - A `loadDir` declaring `"type": "commonjs"` so Node loads CJS
     bundles the same way Lambda's CJS runtime does.
2. Runs esbuild with the same flags `aws-cdk-lib`'s `NodejsFunction`
   uses by default: `--platform=node --target=node22 --minify
--external:@aws-sdk/* --external:@smithy/*`. The format and
   `--main-fields` flip depending on the scenario.
3. Loads the bundled artifact, which runs its top-level module init —
   the same path that crashes the Lambda — then invokes the handler
   to confirm exports are reachable.

## Scenarios

- **CJS** — `OutputFormat.CJS` with `mainFields=main,module`. The
  bundle is loaded via `require()`.
- **ESM** — `OutputFormat.ESM` with `mainFields=module,main`. The
  bundle is loaded via dynamic `import()`.
- **ESM + require polyfill** — `OutputFormat.ESM` with a `require`
  polyfill banner (`createRequire(import.meta.url)`). Mirrors a
  common `NodejsFunction.bundling.banner` pattern.
- **CJS + bundleAwsSDK** / **ESM + bundleAwsSDK** —
  `bundleAwsSDK: true` opts into inlining `@aws-sdk/*` and
  `@smithy/*` instead of marking them external, exercising a
  different resolution path through esbuild.

[#539]: https://github.com/aws/aws-durable-execution-sdk-js/pull/539
[#546]: https://github.com/aws/aws-durable-execution-sdk-js/pull/546
[#562]: https://github.com/aws/aws-durable-execution-sdk-js/pull/562
