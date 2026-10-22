import { withDurableExecution } from "../with-durable-execution.js";
import { createInMemoryService } from "./in-memory-service.js";

// Runs a workflow to completion against the in-memory service. Between invocations it
// delivers outside outcomes, or skips virtual time to the next due item.
export async function runDurable({
  workflow,
  input,
  onCallback,
  functions,
  maxInvocations = 100,
  pageSize,
}) {
  const service = createInMemoryService({
    input,
    onCallback,
    functions,
    pageSize,
  });
  const handler = withDurableExecution(workflow, { client: service.client });
  let invocations = 0;
  let lastError;
  const done = (status, fields = {}) => {
    const operations = [...service.ops.values()].map((op) =>
      structuredClone(op),
    );
    return {
      status,
      ...fields,
      operations,
      invocations,
      getOperation: (name) => operations.find((op) => op.Name === name),
    };
  };

  for (;;) {
    if (invocations >= maxInvocations) {
      throw new Error(
        `runDurable: the execution did not finish in ${maxInvocations} invocations. ` +
          `Last invocation error: ${lastError?.stack ?? lastError}`,
        { cause: lastError },
      );
    }
    invocations++;
    let output;
    try {
      output = await handler(service.event(), {
        awsRequestId: `request-${invocations}`,
        getRemainingTimeInMillis: () => 900_000,
      });
    } catch (err) {
      // Lambda invokes again after an invocation error.
      lastError = err;
      await service.boundary();
      continue;
    }
    service.complete(output);
    if (output.Status === "SUCCEEDED") {
      const raw = output.Result === "" ? service.result : output.Result;
      return done("SUCCEEDED", {
        result: raw === undefined ? undefined : JSON.parse(raw),
      });
    }
    if (output.Status === "FAILED")
      return done("FAILED", { error: output.Error });
    // Nothing arrived and nothing is scheduled: the execution is stuck, for example on
    // a callback that never gets an answer.
    if ((await service.boundary()) === 0 && !service.advance()) {
      return done("PENDING");
    }
  }
}
