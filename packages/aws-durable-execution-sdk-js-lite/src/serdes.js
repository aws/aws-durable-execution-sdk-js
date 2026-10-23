// Calls a custom serdes that the developer passed to an operation. The default JSON path
// does not call these functions, so it has no extra await.
//
// 1. entityId is the operation's raw id, for example "2-1". The full SDK passes the
//    same value.
// 2. A serdes call can be async, for example an S3 upload. While it runs, the execution
//    counts it as running. Otherwise the invocation could suspend during the call. The
//    operation would then never continue in this invocation.
// 3. The full SDK ends the invocation with SerdesFailedError when a serdes call throws.
//    Lambda then invokes again, and a failed S3 call can succeed then. So a throw here
//    throws from the Lambda handler too. The operation's promise never resolves.

const never = () => new Promise(() => {});

async function call(ctx, entityId, what, run) {
  const execution = ctx._execution;
  execution.runningStart();
  try {
    return await run({ entityId, durableExecutionArn: execution.arn });
  } catch (err) {
    const error = new Error(
      `${what} failed for operation ${entityId}: ${err?.message ?? err}`,
      { cause: err },
    );
    error.name = "SerdesFailedError";
    execution.abort(error);
    return never();
  } finally {
    execution.runningEnd();
  }
}

export const serialize = (ctx, serdes, value, entityId) =>
  call(ctx, entityId, "Serialization", (c) =>
    serdes.serialize({ value, ...c }),
  );

// The service omits an absent Result or sends null. Both reach deserialize as undefined.
export const deserialize = (ctx, serdes, data, entityId) =>
  call(ctx, entityId, "Deserialization", (c) =>
    serdes.deserialize({ data: data ?? undefined, ...c }),
  );
