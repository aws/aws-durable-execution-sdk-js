# Lambda Runtime Detection Integration Test

This package verifies that the SDK's `isInLambdaRuntime()` correctly
detects whether it's running from inside the Lambda runtime directory,
and exposes the result via the `-bundled` suffix on the SDK_VERSION
string baked into outgoing UserAgent headers.

## Background

`@aws/durable-execution-sdk-js` reports two version flavours:

- `<version>` for SDK copies installed as a normal user dependency
  (the typical case).
- `<version>-bundled` when the SDK is shipped pre-installed inside a
  Lambda Runtime layer.

The detection compares the directory of the currently-executing
module file against `LAMBDA_RUNTIME_DIR` (defaults to `/var/runtime`).
The module-file path is sourced differently depending on module
system: `__filename` in CJS, `import.meta.url` in ESM. Both branches
need to actually return the SDK's path; an earlier ESM implementation
used `new Function("return import.meta")()`, which runs its body in
non-module scope where `import.meta` is unavailable, so ESM
consumers silently dropped the `-bundled` suffix.

## Usage

```bash
npm run test -w packages/lambda-runtime-detection-integration-test
```

## What it does

Spawns child Node processes with controlled `LAMBDA_RUNTIME_DIR`
settings, instantiates `DurableExecutionApiClient` in each child
(which constructs a `LambdaClient` with the SDK's name and version
baked into `customUserAgent`), and asserts that the resulting
SDK_VERSION string carries (or doesn't carry) the `-bundled` suffix.

Scenarios:

- **CJS / runtime dir matches** — child loads the SDK via `require()`
  and sets `LAMBDA_RUNTIME_DIR` to the SDK's install path; expects
  `-bundled`.
- **CJS / runtime dir does not match** — same but with a different
  `LAMBDA_RUNTIME_DIR`; expects no `-bundled`.
- **ESM / runtime dir matches** — child loads the SDK via dynamic
  `import` and sets `LAMBDA_RUNTIME_DIR` to the SDK's install path;
  expects `-bundled`.
- **ESM / runtime dir does not match** — same but with a different
  `LAMBDA_RUNTIME_DIR`; expects no `-bundled`.

Child processes are needed because the detection runs at
module-load time. The detection logic itself is hidden from Jest by
a manual mock, so this integration test is the only place it's
exercised.
