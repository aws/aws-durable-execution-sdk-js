# ESM Integration Test

This package tests ECMAScript Module (ESM) compatibility of the AWS Durable Execution SDK.

## Purpose

- Verifies that external ESM projects can successfully import and use the SDK
- Catches ESM regressions during development
- Runs as part of the main test suite to ensure compatibility

## Usage

```bash
npm run test -w packages/esm-integration-test
```

## What it tests

- Basic ESM `import` of the SDK
- Availability of core exports like `withDurableExecution`
- No runtime errors during import in ESM environments
