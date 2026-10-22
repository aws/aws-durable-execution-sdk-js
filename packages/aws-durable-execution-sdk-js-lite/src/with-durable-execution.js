import { createContext } from "./context.js";
import { toErrorObject } from "./errors.js";
import { createExecution } from "./execution.js";
import { createLambdaClient } from "./transport/lambda-client.js";

// Lambda's response limit is 6 MiB. The 50 bytes leave room for the envelope.
const MAX_RESULT_BYTES = 6 * 1024 * 1024 - 50;

export function withDurableExecution(handler, { client } = {}) {
  return async (event, lambdaContext) => {
    const { DurableExecutionArn: arn, CheckpointToken: token } = event ?? {};
    if (!arn || !token) {
      throw new Error(
        "Unexpected payload: DurableExecutionArn and CheckpointToken are required. " +
          "Is durable execution enabled for this function?",
      );
    }
    // Created per invocation, so credentials rotated by Lambda are picked up.
    const api = client ?? createLambdaClient();
    const operations = await loadOperations(api, arn, token, event);
    const execution = createExecution({ client: api, arn, token, operations });
    const ctx = createContext({ execution });
    const input = operations[0]?.ExecutionDetails?.InputPayload;

    // Returns the outcome if the execution terminated before p settled.
    const settle = (p) =>
      Promise.race([p.then(() => undefined), execution.terminated]);

    const handlerDone = Promise.resolve()
      .then(() =>
        handler({ event: input ? JSON.parse(input) : {}, ctx, lambdaContext }),
      )
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    const first = await Promise.race([handlerDone, execution.terminated]);
    if (first.kind) return output(first);
    // The handler finished. Un-awaited blocked operations must not suspend it now.
    execution.runningStart();

    let outcome = await settle(execution.drain());
    if (outcome) return output(outcome);
    if ("error" in first) {
      return { Status: "FAILED", Error: toErrorObject(first.error) };
    }
    const result = JSON.stringify(first.value);
    if (result === undefined) return { Status: "SUCCEEDED" };
    if (Buffer.byteLength(result) <= MAX_RESULT_BYTES) {
      return { Status: "SUCCEEDED", Result: result };
    }
    // Too large for the Lambda response. The service stores it from a checkpoint instead.
    outcome = await settle(
      execution.checkpoint({
        ...ctx._base(`execution-result-${Date.now()}`, { type: "EXECUTION" }),
        Action: "SUCCEED",
        Payload: result,
      }),
    );
    return outcome ? output(outcome) : { Status: "SUCCEEDED", Result: "" };
  };
}

function output({ kind, error }) {
  if (kind === "pending") return { Status: "PENDING" };
  if (kind === "failed")
    return { Status: "FAILED", Error: toErrorObject(error) };
  throw error;
}

async function loadOperations(api, arn, token, event) {
  const operations = [...(event.InitialExecutionState?.Operations ?? [])];
  let marker = event.InitialExecutionState?.NextMarker;
  while (marker) {
    const page = await api.getExecutionState({
      DurableExecutionArn: arn,
      CheckpointToken: token,
      Marker: marker,
      MaxItems: 1000,
    });
    operations.push(...(page.Operations ?? []));
    marker = page.NextMarker;
  }
  return operations;
}
