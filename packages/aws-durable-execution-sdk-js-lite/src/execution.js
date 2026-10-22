const MAX_UPDATES = 250;
// The full SDK limits one checkpoint request to 750 KiB. A request that the service
// rejects fails the execution. So the lite SDK uses the same limit.
const MAX_REQUEST_BYTES = 750 * 1024;
const never = () => new Promise(() => {});

// Per-invocation state: the operation records, the checkpoint queue and suspension.
export function createExecution({ client, arn, token, operations }) {
  const state = new Map(operations.map((op) => [op.Id, op]));
  let pending = []; // { update, resolve }
  let last = Promise.resolve(); // resolves after the latest queued update is saved
  let scheduled = false;
  let inFlight = false;
  let running = 0;
  let blocked = 0;
  let done = false;
  let settle;
  const terminated = new Promise((resolve) => {
    settle = resolve;
  });

  // The first outcome wins. Pending callers are never resolved, so user code stops.
  function terminate(outcome) {
    if (done) return;
    done = true;
    pending = [];
    settle(outcome);
  }

  function checkpoint(update) {
    if (done) return never();
    last = new Promise((resolve) => pending.push({ update, resolve }));
    schedule();
    return last;
  }

  // setImmediate lets updates from the same tick go in one request.
  function schedule() {
    if (scheduled || inFlight || pending.length === 0) return;
    scheduled = true;
    setImmediate(flush);
  }

  // Takes updates in order while the request stays within both limits. The first update
  // is always taken, so an update larger than the byte limit still goes out alone.
  function takeBatch() {
    let size = token.length + 100; // the request fields besides Updates, like the full SDK
    let n = 0;
    while (n < pending.length && n < MAX_UPDATES) {
      size += Buffer.byteLength(JSON.stringify(pending[n].update));
      if (n > 0 && size > MAX_REQUEST_BYTES) break;
      n++;
    }
    return pending.splice(0, n);
  }

  async function flush() {
    scheduled = false;
    if (done) return;
    const batch = takeBatch();
    const updates = batch.map((b) => b.update);
    inFlight = true;
    let res;
    try {
      res = await client.checkpoint({
        DurableExecutionArn: arn,
        CheckpointToken: token,
        Updates: updates,
      });
    } catch (err) {
      terminate(classify(err));
      return;
    } finally {
      inFlight = false;
    }
    if (done) return;
    // No token means a newer invocation took over. Finishing the execution is the
    // exception: the service legitimately returns no token after it.
    if (!res.CheckpointToken && !updates.some((u) => u.Type === "EXECUTION")) {
      terminate({ kind: "pending" });
      return;
    }
    token = res.CheckpointToken ?? token;
    for (const op of res.NewExecutionState?.Operations ?? []) {
      state.set(op.Id, op);
    }
    for (const b of batch) b.resolve();
    schedule();
    checkIdle();
  }

  // Suspend when nothing can make progress without the service. The second check after
  // setImmediate lets already-resolved promises start the next operation first.
  const idle = () =>
    !done &&
    running === 0 &&
    blocked > 0 &&
    pending.length === 0 &&
    !scheduled &&
    !inFlight;
  function checkIdle() {
    if (!idle()) return;
    setImmediate(() => {
      if (idle()) terminate({ kind: "pending" });
    });
  }

  return {
    terminated,
    get: (id) => state.get(id),
    get size() {
      return state.size;
    },
    checkpoint,
    // Resolves once every update queued so far is saved. Never resolves after terminate.
    drain: () => last,
    runningStart() {
      running++;
    },
    runningEnd() {
      running--;
      checkIdle();
    },
    // The operation needs the service to act first. Its promise never resolves.
    block() {
      blocked++;
      checkIdle();
      return never();
    },
    fail(error) {
      terminate({ kind: "failed", error });
    },
  };
}

// Throwing makes Lambda invoke again. Only errors that a new invocation can fix throw.
export function classify(err) {
  const status = err?.status;
  const name = err?.name ?? "";
  const clientError = status >= 400 && status < 500 && status !== 429;
  if (
    clientError &&
    name === "InvalidParameterValueException" &&
    err.message?.startsWith("Invalid checkpoint token")
  ) {
    return { kind: "throw", error: err };
  }
  if (clientError || (name.startsWith("KMS") && name.endsWith("Exception"))) {
    return { kind: "failed", error: err };
  }
  return { kind: "throw", error: err };
}
