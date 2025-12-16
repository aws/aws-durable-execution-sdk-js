# run-durable CLI

A command-line tool to quickly run and test durable functions locally without writing test code.

## Usage

```bash
npx run-durable [options] <file>
```

### Arguments

- **`<file>`** (required) - Path to the TypeScript or JavaScript file containing the durable function

### Options

- **`--skip-time`** - Enable time skipping in test environment; waits complete instantly
  - Default: time skipping is disabled (waits actually wait for the specified duration)
- **`-v, --verbose`** - Enable verbose logging output
  - Default: verbose logging is disabled
- **`--show-history`** - Display execution history events after completion
  - Default: history is not shown
- **`--handler-export <name>`** - The exported handler function key
  - Default: "handler"
- **`--help`** - Show help information
- **`--version`** - Show version number

## Examples

### Basic Usage

```bash
# Run with default settings (no skip time, no verbose, no history)
npx run-durable hello-world.js
```

### With Time Skipping Enabled

```bash
# Skip time - waits complete instantly
npx run-durable test-wait-simple.js
```

### With Verbose Logging

```bash
# See detailed execution logs
npx run-durable -v step-basic.js
```

### With History Display

```bash
# Show history events table
npx run-durable --show-history step-basic.js
```

### Custom Handler Export

```bash
# Use a custom export name instead of "handler"
npx run-durable --handler-export my-function.js
```

### All Options Combined

```bash
# Skip time + verbose logging + show history
npx run-durable --skip-time --verbose --show-history comprehensive-operations.js
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
- **EventTimestamp**: Timestamp of the event
- **Event-specific details**: StartedDetails, SucceededDetails, FailedDetails, etc.

## Requirements

- The file must export a `handler` or `default` export
- The handler must be wrapped with `withDurableExecution()`

## Example Output

```
Checkpoint server listening on port 54867
Running durable function from: packages/aws-durable-execution-sdk-js-examples/src/examples/step-basic.ts
Skip time: false, Verbose: false, Show history: false

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

The CLI accepts both absolute and relative file paths, making it easy to run from any directory:

### From any directory with relative paths:

```bash
npx run-durable ./src/examples/hello-world.js
```

### With absolute paths:

```bash
npx run-durable /full/path/to/your/durable-function.js
```

## Troubleshooting

**Function hangs or doesn't complete:**

- Try running with `--verbose` to see detailed execution logs
- Check if there are any infinite loops or blocking operations

**Time-based operations take too long:**

- Use `--skip-time` to make waits complete instantly for faster testing
- Default behavior is to actually wait for the specified duration

**Time-based operations complete instantly:**

- This happens when using `--skip-time` flag
- Remove the `--skip-time` flag if you want waits to actually wait for the specified duration

**Cannot find handler:**

- Ensure the file exports `handler` or `default`
- Use `--handler-export <name>` if your handler has a different export name
- Verify the path is correct relative to where you're running the command
