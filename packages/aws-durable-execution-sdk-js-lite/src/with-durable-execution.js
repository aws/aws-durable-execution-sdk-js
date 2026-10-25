import { createContext } from "./context.js";
import { toErrorObject } from "./errors.js";
import { createExecution } from "./execution.js";
import { createPlugins } from "./plugins.js";
import { createLambdaClient } from "./transport/lambda-client.js";

// Lambda's response limit is 6 MiB. The 50 bytes leave room for the envelope.
const MAX_RESULT_BYTES = 6 * 1024 * 1024 - 50;

export function withDurableExecution(handler, { client, plugins } = {}) {
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
    const payload = operations[0]?.ExecutionDetails?.InputPayload;
    const input = payload ? JSON.parse(payload) : {};
    // Without plugins, the invocation calls no plugin code (README 2.12).
    const hooks = plugins?.length
      ? createPlugins(plugins, {
          arn,
          requestId: lambdaContext?.awsRequestId,
          input,
          operations: [...operations],
          updatedOperationIds: event.UpdatedOperationIds ?? [],
          lambdaContext,
        })
      : undefined;
    const execution = createExecution({
      client: api,
      arn,
      token,
      operations,
      onOperationChange: hooks?.onOperationChange,
      wrap: hooks?.wrap,
    });
    const ctx = createContext({ execution });
    if (!hooks) {
      return (await run(handler, { execution, ctx, input, lambdaContext }))
        .output;
    }

    let outcome;
    try {
      outcome = await run(handler, { execution, ctx, input, lambdaContext });
    } catch (error) {
      // The handler throws, so Lambda invokes again.
      await hooks.onInvocationEnd({
        status: "RETRYING",
        result: undefined,
        error,
        operations: execution.snapshot(),
      });
      throw error;
    }
    const { output, value } = outcome;
    await hooks.onInvocationEnd({
      status: output.Status,
      result: value,
      error: output.Error,
      operations: execution.snapshot(),
    });
    return output;
  };
}

// Runs the workflow and saves the remaining checkpoints. Resolves to the Lambda output.
// value is the workflow's return value when the output is SUCCEEDED. Rejects when the
// handler must throw to Lambda.
async function run(handler, { execution, ctx, input, lambdaContext }) {
  // Returns the outcome if the execution terminated before p settled.
  const settle = (p) =>
    Promise.race([p.then(() => undefined), execution.terminated]);
  const wrap = execution.wrap;
  const args = { event: input, ctx, lambdaContext };

  const handlerDone = Promise.resolve()
    .then(() =>
      wrap
        ? wrap({ kind: "invocation", fn: () => handler(args) })
        : handler(args),
    )
    .then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
  const first = await Promise.race([handlerDone, execution.terminated]);
  if (first.kind) return { output: output(first) };
  // The handler finished. Un-awaited blocked operations must not suspend it now.
  execution.runningStart();

  let outcome = await settle(execution.drain());
  if (outcome) return { output: output(outcome) };
  if ("error" in first) {
    return {
      output: { Status: "FAILED", Error: toErrorObject(first.error) },
    };
  }
  const { value } = first;
  const result = JSON.stringify(value);
  if (result === undefined) return { output: { Status: "SUCCEEDED" }, value };
  if (Buffer.byteLength(result) <= MAX_RESULT_BYTES) {
    return { output: { Status: "SUCCEEDED", Result: result }, value };
  }
  // Too large for the Lambda response. The service stores it from a checkpoint instead.
  outcome = await settle(
    execution.checkpoint({
      ...ctx._base(`execution-result-${Date.now()}`, { type: "EXECUTION" }),
      Action: "SUCCEED",
      Payload: result,
    }),
  );
  return outcome
    ? { output: output(outcome) }
    : { output: { Status: "SUCCEEDED", Result: "" }, value };
}

function output({ kind, error }) {
  if (kind === "pending") return { Status: "PENDING" };
  if (kind === "failed")
    return { Status: "FAILED", Error: toErrorObject(error) };
  throw error;
}

// A record timestamp in the invocation event is a number of epoch milliseconds. The API
// sends epoch seconds. Converting the event's records here gives one unit everywhere:
// the state, isDue and the plugins all read epoch seconds. A string is parsed as ISO
// 8601, which the event can also carry.
const toSeconds = (t) =>
  t == null ? t : (typeof t === "number" ? t : Date.parse(t)) / 1000;

function fromEvent(op) {
  const out = { ...op };
  if ("StartTimestamp" in op) out.StartTimestamp = toSeconds(op.StartTimestamp);
  if ("EndTimestamp" in op) out.EndTimestamp = toSeconds(op.EndTimestamp);
  if (op.StepDetails?.NextAttemptTimestamp != null) {
    out.StepDetails = {
      ...op.StepDetails,
      NextAttemptTimestamp: toSeconds(op.StepDetails.NextAttemptTimestamp),
    };
  }
  if (op.WaitDetails?.ScheduledEndTimestamp != null) {
    out.WaitDetails = {
      ...op.WaitDetails,
      ScheduledEndTimestamp: toSeconds(op.WaitDetails.ScheduledEndTimestamp),
    };
  }
  return out;
}

async function loadOperations(api, arn, token, event) {
  const operations = (event.InitialExecutionState?.Operations ?? []).map(
    fromEvent,
  );
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
