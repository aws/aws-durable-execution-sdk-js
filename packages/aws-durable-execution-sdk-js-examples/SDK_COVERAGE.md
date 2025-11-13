# SDK Coverage in Examples Tests

This package is configured to collect code coverage for the core SDK (`aws-durable-execution-sdk-js`) when running example tests.

## How It Works

1. **Pre-test Copy**: Before tests run, `scripts/copy-sdk-source.js` copies the SDK source files into `src/dur-sdk/`
2. **Module Mapping**: Jest is configured to resolve `@aws/durable-execution-sdk-js` imports to the local `src/dur-sdk/index.ts`
3. **Coverage Collection**: Jest collects coverage from both example files and SDK source files

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
