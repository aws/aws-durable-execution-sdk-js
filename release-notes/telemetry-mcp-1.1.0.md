# Telemetry MCP 1.1.0

## Changed

- The server no longer checks whether its credentials can change data. No
  check could show that a `SELECT` cannot write, so every result led to the
  same prompt. Before the first `query`, `get_execution` or `list_executions`
  call in a session, the server now asks you to confirm one line: queries are
  written by the agent, and it is your responsibility to give the server
  read-only credentials.
- On S3 + Athena the prompt also says when Athena writes query results inside
  the table's data location, where every query adds rows, or that it could not
  check the location, and why. When
  `DURABLE_TELEMETRY_CONFIRMED_READONLY=true` skips the prompt, run
  `test_destination` to see this check.
- The prompt's checkbox field is `confirmed` (was `acceptRisk`).
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
