# Telemetry MCP 1.1.0

## Added

- **Execution viewer links.** When a result holds execution ARNs, the server
  adds a `viewerLink` for each one: a column on `query` and `list_executions`
  rows, and a field on a found `get_execution` record. Each is a Markdown link,
  titled with the execution name, to a page in your browser. The page reads the
  execution from the Lambda API each time you open it. It shows the status, the
  execution's input, result and error, the operation tree and the invocations.
  It does not load each step's result or error.
- **The server can now open a listening port.** It starts a web server the
  first time a result needs a link. The server listens on `127.0.0.1` only, on
  a port the operating system picks. Links carry a random ID, not the ARN, and
  stop working when the server stops.
- **New variable:** `DURABLE_TELEMETRY_VIEWER_DISABLED=true` turns the viewer
  off. No port is opened, and results carry no `viewerLink`.
- The page needs `lambda:GetDurableExecution` and
  `lambda:GetDurableExecutionHistory`. Without them the page shows the AWS
  error, and the tools still work.
- **Output change for tools that read results programmatically.** `query` and
  `list_executions` rows can have an extra last column, `viewerLink`.
  `list_executions` rows also have a new `executionName` column (named for each
  destination's casing), after the ARN column. A found `get_execution` result
  can have a `viewerLink` field. Code that reads columns by position needs an
  update.

## Changed

- The server no longer checks whether its credentials can change data. No
  check could show that a `SELECT` cannot write, so every result led to the
  same prompt. Before the first `query`, `get_execution` or `list_executions`
  call in a session, the server now asks you to confirm one line: "I confirm
  that this server's credentials are read-only." Queries are written by the
  agent, so giving the server read-only credentials is your responsibility.
- On S3 + Athena the prompt also says when Athena writes query results inside
  the table's data location, where every query adds rows, or that it could not
  check the location, and why. When
  `DURABLE_TELEMETRY_CONFIRMED_READONLY=true` skips the prompt, run
  `test_destination` to see this check.
- The prompt has no checkbox. Accepting the prompt confirms. Declining or
  cancelling it refuses. The checkbox defaulted to unchecked, so a plain
  Submit counted as a decline.
- **Renamed:** `DURABLE_TELEMETRY_ACCEPT_WRITE_ACCESS` is now
  `DURABLE_TELEMETRY_CONFIRMED_READONLY`. The old name is no longer read. If
  your server's `env` block sets the old name, rename it, or the prompt comes
  back.
- The prompt names `DURABLE_TELEMETRY_CONFIRMED_READONLY`, so a user who
  confirms learns how to stop the prompt in later sessions.

## Removed

- **Output change for tools that read results programmatically.**
  `test_destination` no longer returns a `writeAccess` field. A blocked
  `query`, `get_execution` or `list_executions` result no longer carries
  `writeAccess`, and its `error` and `howToAccept` text changed. Agents read
  these fields as text, so most setups need no change.

## Unchanged

- `DURABLE_TELEMETRY_CONFIRMED_READONLY=true` confirms permanently, as the old
  name did.
- A client without MCP form elicitation still gets a tool error that names the
  variable.
- A call cancelled while it waits for confirmation runs no query.
