# CJS Integration Test

This package tests CommonJS (CJS) compatibility of the AWS Durable Execution SDK.

## Purpose

- Verifies that external CommonJS projects can successfully import and use the SDK
- Catches CJS bundling regressions during development
- Runs as part of the main test suite to ensure compatibility

## Usage

```bash
npm run test -w packages/cjs-integration-test
```

## What it tests

- Basic CJS `require()` import of the SDK
- Availability of core exports like `withDurableExecution`
- No runtime errors during import in CJS environments
