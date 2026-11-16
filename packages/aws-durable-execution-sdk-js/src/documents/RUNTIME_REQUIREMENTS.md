# Runtime requirements

The SDK targets the Lambda managed Node.js runtimes (`nodejs22.x`, `nodejs24.x`), where
everything below is satisfied automatically. It also runs on a **container image carrying your
own JavaScript runtime**, which is how durable functions can be deployed on a runtime Lambda
does not manage.

At load, the SDK imports these Node builtins: `async_hooks`, `crypto`, `events`,
`node:console`, `node:crypto`, `node:fs/promises` (`mkdir`, `readFile`, `writeFile`),
`node:path`, `node:url` and `node:util`. Note that a **named ESM import of a missing export is
fatal at module load**, not at first use — so a runtime that provides a module but not the
member the SDK imports from it will fail with a `SyntaxError` before your handler runs.

It also loads `@aws-sdk/client-lambda` on first checkpoint, via a dynamic import. If you bundle
with `@aws-sdk` marked external, the runtime must provide that client.

## Runtimes without AsyncLocalStorage

Some lightweight runtimes — [LLRT](https://github.com/awslabs/llrt), for example — implement
only part of the Node API. The SDK detects and works around the two gaps that would otherwise be
fatal:

- **`async_hooks.AsyncLocalStorage`** is used to track which durable operation is active across
  `await` boundaries. Without it the SDK falls back to tracking only within synchronous code.
- **`util.formatWithOptions`** is used by the default logger. Without it the SDK falls back to
  `util.format`.

**Checkpointing and replay are unaffected**, and the checkpoint data is byte-for-byte the same.
What degrades is observability, and the SDK emits one warning per execution environment when it
does:

|                                                              | Effect on a runtime without `AsyncLocalStorage`                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Log records emitted after an `await`                         | lose `operationId`, `operationName` and `attempt`                                                                                                                |
| Replay-aware logging                                         | cannot suppress replayed records, so a log statement behind the replay frontier is re-emitted on **every replay** — this adds CloudWatch cost on long executions |
| Using a parent or sibling context inside `runInChildContext` | only detected when it happens synchronously                                                                                                                      |

That last item is a guard against a real determinism bug, so if you deploy on such a runtime,
enable the `no-nested-durable-operations` rule from
[`@aws/durable-execution-sdk-js-eslint-plugin`](https://www.npmjs.com/package/@aws/durable-execution-sdk-js-eslint-plugin),
which catches the same mistake at build time.

Performance is a separate question from support. Durable executions replay, and replay cost grows
with the number of completed operations, so a runtime without a JIT can be slower overall for
workflows with large operation counts or compute-heavy steps — even where it starts faster.
Measure your own workload before switching.
