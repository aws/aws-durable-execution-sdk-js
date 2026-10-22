const MAX_UPDATES = 250;
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

  async function flush() {
    scheduled = false;
    if (done) return;
    const batch = pending.splice(0, MAX_UPDATES);
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
