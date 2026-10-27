import { createInMemoryService } from "./in-memory-service.js";

// Runs an execution to completion against the in-memory service. Between invocations it
// delivers outside outcomes, or skips virtual time to the next due item.
// createHandler(client): returns the withDurableExecution handler built with this client.
// The package does not import the SDK, so the test builds the handler. So the package
// has no dependency, and the test runs the handler with its real config.
// service: an existing in-memory service. A test passes one to call advanceBy() or
// boundary() during an invocation. The service options are then ignored.
export async function runDurable({
  createHandler,
  input,
  onCallback,
  functions,
  maxInvocations = 100,
  pageSize,
  service = createInMemoryService({ input, onCallback, functions, pageSize }),
}) {
  const handler = createHandler(service.client);
  let invocations = 0;
  let lastError;
  // Each invocation error, like the service records them: a throw from the handler, or
  // PENDING while no operation is pending.
  const invocationErrors = [];
  const done = (status, fields = {}) => {
    const operations = [...service.ops.values()].map((op) =>
      structuredClone(op),
    );
    return {
      status,
      ...fields,
      operations,
      invocations,
      invocationErrors,
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
      invocationErrors.push(err);
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
    // Nothing can wake the execution. The service then records an invocation error and
    // invokes again.
    if (!service.hasPending()) {
      lastError = new Error(
        `Invocation ${invocations} returned PENDING while no operation is pending`,
      );
      invocationErrors.push(lastError);
      continue;
    }
    // Nothing arrived and nothing is scheduled: the execution is stuck, for example on
    // a callback that never gets an answer.
    if ((await service.boundary()) === 0 && !service.advance()) {
      return done("PENDING");
    }
  }
}
