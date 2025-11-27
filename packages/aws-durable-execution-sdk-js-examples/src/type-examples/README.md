# Type Examples

Examples that verify exported types and type behavior in the AWS Durable Execution Language SDK.

## Purpose

- Verify exported types from the Language SDK are accessible and work correctly
- Verify type behavior across different usage patterns

## Examples

### `type-inference.ts`

Demonstrates automatic type inference without explicit type parameters. Types are inferred from usage patterns.

### `default-types.ts`

Uses `DurableExecutionHandler` with default type parameters (any, any, DurableLogger).

### `explicit-types.ts`

Uses explicit type parameters with custom interfaces for strongly-typed event handling and results.

## Adding Tests

To test type examples, simply add the TypeScript file. The `tsc` compiler will verify types compile correctly.

No runtime tests are needed - type validation happens at compile time.
