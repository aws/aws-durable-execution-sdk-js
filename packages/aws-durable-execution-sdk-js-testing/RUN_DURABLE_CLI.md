# run-durable CLI

A command-line tool to quickly run and test durable functions locally without writing test code.

## Usage

```bash
npm run run-durable -- <path-to-handler-file> [no-skip-time] [verbose] [show-history]
```

### Parameters

1. **Path to handler file** (required) - Path to the TypeScript file containing the durable function
2. **no-skip-time** (optional) - Disables time skipping; waits will actually wait for the specified duration
   - Default: time skipping is enabled (waits complete instantly)
3. **verbose** (optional) - Enables verbose logging to see detailed execution flow
   - Default: verbose logging is disabled
4. **show-history** (optional) - Displays a table of history events after execution
   - Default: history is not shown

## Examples

### Basic Usage

```bash
# Run with default settings (skip time, no verbose, no history)
npm run run-durable -- packages/aws-durable-execution-sdk-js-examples/src/examples/hello-world.ts
```

### With Time Skipping Disabled

```bash
# Actually wait for the specified duration
npm run run-durable -- packages/aws-durable-execution-sdk-js-examples/src/examples/test-wait-simple.ts no-skip-time
```

### With Verbose Logging

```bash
# See detailed execution logs
npm run run-durable -- packages/aws-durable-execution-sdk-js-examples/src/examples/step-basic.ts skip-time verbose
```

### With History Display

```bash
# Show history events table
npm run run-durable -- packages/aws-durable-execution-sdk-js-examples/src/examples/step-basic.ts skip-time no-verbose show-history
```

### All Options Combined

```bash
# Don't skip time + verbose logging + show history
npm run run-durable -- packages/aws-durable-execution-sdk-js-examples/src/examples/comprehensive-operations.ts no-skip-time verbose show-history
```

## Output

The CLI will:

1. Start a local checkpoint server
2. Display configuration (skip time, verbose, show history)
3. Execute the durable function
4. Print a table of all operations with details:
   - Parent ID
   - Name
   - Type (STEP, WAIT, PARALLEL, etc.)
   - SubType
   - Status (SUCCEEDED, FAILED, etc.)
   - Start time
   - End time
   - Duration
5. Display the execution status
6. (Optional) Show history events table if `show-history` is enabled
7. Show the result (or error if failed)

## History Events

When `show-history` is enabled, you'll see a detailed table including:

- **EventType**: ExecutionStarted, StepStarted, StepSucceeded, WaitStarted, WaitSucceeded, etc.
- **EventId**: Sequential event identifier
- **Id**: Operation identifier
- **EventTimestamp**: Unix timestamp of the event
- **Event-specific details**: StartedDetails, SucceededDetails, FailedDetails, etc.

## Requirements

- The file must export a `handler` or `default` export
- The handler must be wrapped with `withDurableExecution()`

## Example Output

```
Checkpoint server listening on port 54867
Running durable function from: packages/aws-durable-execution-sdk-js-examples/src/examples/step-basic.ts
Skip time: true, Verbose: false, Show history: false

┌─────────┬──────────┬──────┬────────┬─────────┬─────────────┬────────────────────────────┬────────────────────────────┬──────────┐
│ (index) │ parentId │ name │ type   │ subType │ status      │ startTime                  │ endTime                    │ duration │
├─────────┼──────────┼──────┼────────┼─────────┼─────────────┼────────────────────────────┼────────────────────────────┼──────────┤
│ 0       │ '-'      │ '-'  │ 'STEP' │ 'Step'  │ 'SUCCEEDED' │ '2025-10-23T17:10:10.000Z' │ '2025-10-23T17:10:10.000Z' │ '0ms'    │
└─────────┴──────────┴──────┴────────┴─────────┴─────────────┴────────────────────────────┴────────────────────────────┴──────────┘

Execution Status: SUCCEEDED

Result:
"step completed"
```

## Running from Different Locations

### From monorepo root:

```bash
npm run run-durable -- packages/aws-durable-execution-sdk-js-examples/src/examples/hello-world.ts
```

### From testing package directory:

```bash
npm run run-durable -- ../aws-durable-execution-sdk-js-examples/src/examples/hello-world.ts
```

### From examples package directory:

```bash
npm run run-durable -- src/examples/hello-world.ts
```

## Troubleshooting

**Function hangs or doesn't complete:**

- Try running with `verbose` to see detailed execution logs
- Check if there are any infinite loops or blocking operations

**Time-based operations complete instantly:**

- This is expected behavior with default settings
- Use `no-skip-time` parameter to actually wait for the specified duration

**Cannot find handler:**

- Ensure the file exports `handler` or `default`
- Verify the path is correct relative to where you're running the command
