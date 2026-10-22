import { withDurableExecution } from "../../src/with-durable-execution.js";
import { createFakeClient, event, executionOp } from "./fake-client.js";

// Runs one invocation against a fake client seeded with the same records as the event.
export async function invoke(handler, { operations = [], input, client } = {}) {
  client ??= createFakeClient({
    operations: [executionOp(input), ...operations],
  });
  const output = await withDurableExecution(handler, { client })(
    event(operations, { input }),
    {},
  );
  const updates = client.checkpoints.flatMap((r) => r.Updates);
  return { output, client, updates };
}
