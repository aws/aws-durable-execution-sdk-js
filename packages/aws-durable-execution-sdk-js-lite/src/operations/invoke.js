// Replay table for invoke (Type CHAINED_INVOKE, SubType ChainedInvoke):
//
// | Record status                | Behavior                                            |
// |------------------------------|-----------------------------------------------------|
// | none                         | send START with Payload and ChainedInvokeOptions,   |
// |                              | then as the new record (normally STARTED)           |
// | SUCCEEDED                    | return JSON.parse(ChainedInvokeDetails.Result)      |
// | FAILED, TIMED_OUT, STOPPED   | throw fromErrorObject(ChainedInvokeDetails.Error)   |
// | STARTED or anything else     | block until the service finishes the invoke         |
//
// The thrown error keeps the callee's ErrorType. The full SDK loses it.

import { fromErrorObject } from "../errors.js";

const FAILED = new Set(["FAILED", "TIMED_OUT", "STOPPED"]);

export function invoke(ctx, opts) {
  // The id is taken now, before any await (AGENTS.md 2.4).
  return runInvoke(ctx, ctx._nextId(), opts);
}

async function runInvoke(ctx, rawId, { name, functionName, input, tenantId }) {
  const execution = ctx._execution;
  const meta = { type: "CHAINED_INVOKE", subType: "ChainedInvoke", name };
  let record = ctx._lookup(rawId);
  if (!ctx._mayRun(record, meta)) return new Promise(() => {});
  if (!record) {
    await execution.checkpoint({
      ...ctx._base(rawId, meta),
      Action: "START",
      // JSON.stringify(undefined) is undefined, so no input means no Payload.
      ...(input !== undefined && { Payload: JSON.stringify(input) }),
      ChainedInvokeOptions: {
        FunctionName: functionName,
        ...(tenantId !== undefined && { TenantId: tenantId }),
      },
    });
    record = ctx._lookup(rawId);
  }
  const details = record?.ChainedInvokeDetails;
  if (record?.Status === "SUCCEEDED") {
    return details?.Result == null ? undefined : JSON.parse(details.Result);
  }
  if (FAILED.has(record?.Status)) {
    throw fromErrorObject(details?.Error, "InvokeError");
  }
  return execution.block();
}
