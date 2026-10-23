// The service has no limit on the number of updates in one request. It limits the raw
// HTTP request to about 6 MiB, and a rejected request fails the execution. So the SDK
// keeps each request body at most 5 MiB, which leaves room for the HTTP headers.
const MAX_BODY_BYTES = 5 * 1024 * 1024;
// The client generates a ClientToken with crypto.randomUUID(), which is 36 characters.
const CLIENT_TOKEN = "00000000-0000-0000-0000-000000000000";
const never = () => new Promise(() => {});

// Per-invocation state: the operation records, the checkpoint queue and suspension.
export function createExecution({ client, arn, token, operations }) {
  const state = new Map(operations.map((op) => [op.Id, op]));
  let pending = []; // { update, resolve }
  let last = Promise.resolve(); // resolves after the latest queued update is saved
  let scheduled = false;
  let inFlight = false;
  let running = 0;
  const blocked = []; // one liveness check per blocked operation
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
  // The body is JSON.stringify({CheckpointToken, ClientToken, Updates}). Its size is the
  // body with no updates, plus each update's JSON, plus one comma between updates. So the
  // sum below is the exact body size. The first update is always taken.
  function takeBatch() {
    let size = Buffer.byteLength(
      JSON.stringify({
        CheckpointToken: token,
        ClientToken: CLIENT_TOKEN,
        Updates: [],
      }),
    );
    let n = 0;
    while (n < pending.length) {
      size += Buffer.byteLength(JSON.stringify(pending[n].update)) + (n > 0);
      if (n > 0 && size > MAX_BODY_BYTES) break;
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
    blocked.some((isLive) => isLive()) &&
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
    // True after the invocation's outcome is decided. Code that did not wait for a
    // checkpoint can still be running then, so a step checks this before it runs fn.
    get done() {
      return done;
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
    // isLive turns false when a batch abandons the operation (AGENTS.md 2.9). Then the
    // operation no longer counts as blocked.
    block(isLive = () => true) {
      blocked.push(isLive);
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
