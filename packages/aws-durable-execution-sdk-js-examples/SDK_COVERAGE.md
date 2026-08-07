# SDK Coverage in Examples Tests

This package is configured to collect code coverage for the core SDK (`aws-durable-execution-sdk-js`) when running example tests.

## How It Works

1. **Pre-test Copy**: Before tests run, `scripts/copy-sdk-source.js` copies the SDK source files into `src/dur-sdk/`
2. **Version Stub Substitution**: The copy script then overwrites the copied `utils/constants/version.ts` with its own `utils/constants/__mocks__/version.ts` stub (see below)
3. **Module Mapping**: Jest is configured to resolve `@aws/durable-execution-sdk-js` imports to the local `src/dur-sdk/index.ts`
4. **Coverage Collection**: Jest collects coverage from both example files and SDK source files

### Why version.ts is substituted

The real `utils/constants/version.ts` reads `import.meta.url` at the top level.
`ts-jest` compiles with `module: commonjs`, where `import.meta` is a hard
compile error (TS1343) — so _every_ suite that transitively imports the SDK
fails to compile and the harness reports no coverage at all.

The SDK's own unit tests already avoid this through the manual mock at
`utils/constants/__mocks__/version.ts`, so the copy script reuses it. Only the
UserAgent version string differs, and no example asserts on it.

Two things to know if you touch this:

- If `__mocks__/version.ts` is ever renamed or removed, the copy script prints a
  warning (`⚠ Expected version mock ... was not found`) and the coverage run
  will fail with TS1343. The warning is the thing to grep for.
- The substitution means `src/dur-sdk/` is _not_ a byte-faithful copy of the
  SDK. If new top-level `import.meta` usage is added anywhere else in the SDK,
  TS1343 will return and will need the same treatment (or the coverage config
  moved to an ESM-capable `module` target).

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
- Run all example tests
- Generate coverage report in `coverage-sdk/` directory

## Coverage Output

- **HTML Report**: `coverage-sdk/index.html`
- **Cobertura XML**: `coverage-sdk/cobertura-coverage.xml`
- **Console**: Summary printed after test run

## Files

- `scripts/copy-sdk-source.js` - Copies SDK source before tests
- `jest.config.js` - Regular test configuration
- `jest.config.sdk-coverage.js` - SDK coverage configuration
- `src/dur-sdk/` - Temporary SDK source (gitignored)
- `coverage-sdk/` - Coverage output directory (gitignored)

## Notes

- The `src/dur-sdk/` folder is automatically created and should not be committed
- Coverage includes both example code and SDK code executed by the examples
- The SDK source is copied fresh before each test run to ensure it's up-to-date
- The copied `utils/constants/version.ts` is a stub, not the real module (see
  [Why version.ts is substituted](#why-versionts-is-substituted))
