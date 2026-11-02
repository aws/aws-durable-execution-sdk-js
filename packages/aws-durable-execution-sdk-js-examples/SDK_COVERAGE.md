# SDK Coverage in Examples Tests

This package is configured to collect code coverage for the core SDK (`aws-durable-execution-sdk-js`) when running example tests.

## How It Works

1. **Pre-test Copy**: Before tests run, `scripts/copy-sdk-source.js` copies the SDK source files into `src/dur-sdk/`
2. **Module Alias**: When `SDK_COVERAGE=true`, `vitest.config.ts` resolves `@aws/durable-execution-sdk-js` imports to the local `src/dur-sdk/index.ts`
3. **Coverage Collection**: Vitest collects V8 coverage (`@vitest/coverage-v8`) from both example files and SDK source files

The copy is byte-faithful. Vitest compiles the tests as ESM, so the SDK's
top-level `import.meta.url` in `utils/constants/version.ts` works as is. The
Jest setup had to swap that file for a stub, because `ts-jest` compiled with
`module: commonjs` and failed with TS1343. That step is gone.

## Running Tests

**Regular tests (examples only):**

```bash
npm test
```

**Tests with SDK coverage:**

```bash
npm run test-with-sdk-coverage
```

This will:

- Copy SDK source to `src/dur-sdk/`
- Run all example tests with `SDK_COVERAGE=true vitest run --coverage`
- Generate coverage report in `coverage-sdk/` directory, even when a test fails

## Coverage Output

- **HTML Report**: `coverage-sdk/index.html`
- **Cobertura XML**: `coverage-sdk/cobertura-coverage.xml`
- **Console**: Summary printed after test run

## Files

- `scripts/copy-sdk-source.js` - Copies SDK source before tests
- `vitest.config.ts` - Test configuration for all modes. `SDK_COVERAGE=true` turns on the SDK alias, and the `coverage` block sets the reporters, the `coverage-sdk/` output directory and the included files
- `src/dur-sdk/` - Temporary SDK source (gitignored)
- `coverage-sdk/` - Coverage output directory (gitignored)

## Notes

- The `src/dur-sdk/` folder is automatically created and should not be committed
- Coverage includes both example code and SDK code executed by the examples
- The SDK source is copied fresh before each test run to ensure it's up-to-date
