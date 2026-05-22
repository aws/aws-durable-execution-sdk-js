# CJS Integration Test

This package tests that the AWS Durable Execution SDK can be consumed by external CommonJS projects without errors.

## Purpose

- Catches CJS compatibility issues like the `fileURLToPath` error we fixed
- Simulates real-world usage by external projects
- Runs as a separate package to ensure proper module resolution

## Usage

```bash
npm run test
```

This test will fail if there are any CJS import or initialization errors.
