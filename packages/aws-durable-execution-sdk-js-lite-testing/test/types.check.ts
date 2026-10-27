// Compile-only check of src/index.d.ts against the lite SDK's types. See README
// "Contributing" for the command.
import { withDurableExecution } from "../../aws-durable-execution-sdk-js-lite/src/index.js";
import { createInMemoryService, runDurable } from "../src/index.js";

const workflow = async ({
  event,
}: {
  event: { n: number };
}): Promise<number> => event.n + 1;

export async function check(): Promise<number | undefined> {
  // The handler that withDurableExecution returns fits createHandler.
  const run = await runDurable<number>({
    createHandler: (client) => withDurableExecution(workflow, { client }),
    input: { n: 1 },
  });
  const service = createInMemoryService({ input: { n: 1 } });
  await runDurable({
    service,
    createHandler: (client) => withDurableExecution(workflow, { client }),
  });
  service.advanceBy(1);
  return run.result;
}
