// Replay table for invoke (Type CHAINED_INVOKE, SubType ChainedInvoke):
//
// | Record status                | Behavior                                            |
// |------------------------------|-----------------------------------------------------|
// | none                         | send START with Payload and ChainedInvokeOptions,   |
// |                              | then as the new record (normally STARTED)           |
// | SUCCEEDED                    | return JSON.parse(Result), or resultSerdes          |
// | FAILED, TIMED_OUT, STOPPED   | throw fromErrorObject(ChainedInvokeDetails.Error)   |
// | STARTED or anything else     | block until the service finishes the invoke         |
//
// A blocked invoke wakes when a checkpoint response changes its record (AGENTS.md 2.5).
// It then applies this table to the new record.
// The thrown error keeps the callee's ErrorType. The full SDK loses it.
// payloadSerdes makes the START Payload from input. resultSerdes reads the callee's
// Result. The callee's result always comes from the record, so every run deserializes.

import { fromErrorObject } from "../errors.js";
import { CUSTOM_PAYLOAD } from "../execution.js";
import { deserialize, serialize } from "../serdes.js";

const FAILED = new Set(["FAILED", "TIMED_OUT", "STOPPED"]);

export function invoke(ctx, opts) {
  // The id is taken now, before any await (AGENTS.md 2.4).
  return runInvoke(ctx, ctx._nextId(), opts);
}

async function runInvoke(
  ctx,
  rawId,
  { name, functionName, input, tenantId, payloadSerdes, resultSerdes },
) {
  const meta = { type: "CHAINED_INVOKE", subType: "ChainedInvoke", name };
  let record = ctx._lookup(rawId);
  if (!ctx._mayRun(record, meta)) return new Promise(() => {});
  if (!record) {
    // JSON.stringify(undefined) is undefined, so no input means no Payload.
    const payload = payloadSerdes
      ? await serialize(ctx, payloadSerdes, input, rawId)
      : JSON.stringify(input);
    await ctx._checkpoint({
      ...ctx._base(rawId, meta),
      Action: "START",
      ...(payload !== undefined && { Payload: payload }),
      ...(payloadSerdes && { [CUSTOM_PAYLOAD]: true }),
      ChainedInvokeOptions: {
        FunctionName: functionName,
        ...(tenantId !== undefined && { TenantId: tenantId }),
      },
    });
    record = ctx._lookup(rawId);
  }
  // The block resolves when a checkpoint response changes the record. The loop then
  // applies the replay table to the new record.
  for (;;) {
    const details = record?.ChainedInvokeDetails;
    if (record?.Status === "SUCCEEDED") {
      const data = details?.Result;
      if (resultSerdes) return deserialize(ctx, resultSerdes, data, rawId);
      return data == null ? undefined : JSON.parse(data);
    }
    if (FAILED.has(record?.Status)) {
      throw fromErrorObject(details?.Error, "InvokeError");
    }
    await ctx._block(rawId);
    record = ctx._lookup(rawId);
  }
}
