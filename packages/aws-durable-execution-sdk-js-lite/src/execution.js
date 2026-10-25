// The service has no limit on the number of updates in one request. It limits the raw
// HTTP request to about 6 MiB, and a rejected request fails the execution. So the SDK
// keeps each request body at most 5 MiB, which leaves room for the HTTP headers.
const MAX_BODY_BYTES = 5 * 1024 * 1024;
// The client generates a ClientToken with crypto.randomUUID(), which is 36 characters.
const CLIENT_TOKEN = "00000000-0000-0000-0000-000000000000";
const never = () => new Promise(() => {});

// An operation sets this key to true on an update whose Payload a custom serdes made.
// JSON.stringify skips symbol keys, so the key is never sent.
export const CUSTOM_PAYLOAD = Symbol("customPayload");

// An upper bound on Buffer.byteLength(JSON.stringify(update)) + 1 (the comma), without
// serializing the update. Serializing every update only to measure it doubled the
// serialization work. Inside the request body:
// 1. A Payload from JSON.stringify is JSON text. JSON-escaping it again turns a quote or a
//    backslash into 2 bytes, and leaves other bytes alone. So it takes at most 2 * its
//    UTF-8 bytes.
//    A custom serialize can return any string. A control character in it becomes \u00XX.
//    So a Payload marked CUSTOM_PAYLOAD counts 6 bytes per UTF-16 unit, like rule 3.
// 2. Id, ParentId, Type, SubType and Action are SDK-made ASCII without escapes: 1 byte per
//    character.
// 3. A string from the developer can hold control characters. Each becomes \u00XX: at
//    most 6 bytes per UTF-16 unit.
// 4. The keys, punctuation and numbers of the largest update take about 500 bytes. 600
//    leaves a margin.
const len = (s) => (typeof s === "string" ? s.length : 0);
const FIXED_BYTES = 600;
export function sizeBound(u) {
  const e = u.Error;
  const invoke = u.ChainedInvokeOptions;
  return (
    FIXED_BYTES +
    (u.Payload
      ? u[CUSTOM_PAYLOAD]
        ? 6 * u.Payload.length
        : 2 * Buffer.byteLength(u.Payload)
      : 0) +
    len(u.Id) +
    len(u.ParentId) +
    len(u.Type) +
    len(u.SubType) +
    len(u.Action) +
    6 *
      (len(u.Name) +
        len(e?.ErrorType) +
        len(e?.ErrorMessage) +
        len(e?.ErrorData) +
        len(invoke?.FunctionName) +
        len(invoke?.TenantId) +
        len(invoke?.XAmznTraceId))
  );
}

// True if the record's scheduled time has passed: a wait's end or a step's next attempt.
// Every stored timestamp is a number of epoch seconds: the API sends seconds, and
// withDurableExecution converts the invocation event's milliseconds on load. A callback
// or an invoke has no scheduled time.
function isDue(op) {
  const t =
    op?.Type === "WAIT"
      ? op.WaitDetails?.ScheduledEndTimestamp
      : op?.Type === "STEP"
        ? op.StepDetails?.NextAttemptTimestamp
        : undefined;
  if (t == null) return false;
  return t * 1000 <= Date.now();
}

// Per-invocation state: the operation records, the checkpoint queue and suspension.
// onOperationChange, wrap and traceHeader are the plugins' hooks (README 2.12). Each is
// undefined when no plugin has the hook.
export function createExecution({
  client,
  arn,
  token,
  operations,
  onOperationChange,
  wrap,
  traceHeader,
}) {
  const state = new Map(operations.map((op) => [op.Id, op]));
  let pending = []; // { update, resolve }
  let last = Promise.resolve(); // resolves after the latest queued update is saved
  let scheduled = false;
  let inFlight = false;
  let running = 0;
  const blocked = new Set(); // { id, status, isLive, wake }, one per blocked operation
  // True after an empty refresh checkpoint that woke nothing. Reset when an op wakes.
  let refreshed = false;
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

  // Takes updates in order while the request stays within the byte limit. The first update
  // is always taken, so an update larger than the limit still goes out alone. The size is
  // an upper bound (sizeBound), so the real body is never larger than the limit.
  function takeBatch() {
    let size = token.length + CLIENT_TOKEN.length + 100;
    let n = 0;
    while (n < pending.length) {
      size += sizeBound(pending[n].update);
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
    const returned = res.NewExecutionState?.Operations ?? [];
    for (const op of returned) {
      state.set(op.Id, op);
    }
    // The hook is not awaited. The snapshot is built only when a plugin has the hook.
    // A throw from the hook makes the handler throw, like a serdes failure (README 2.12).
    if (onOperationChange && returned.length > 0) {
      try {
        onOperationChange({
          updated: returned,
          operations: [...state.values()],
        });
      } catch (err) {
        terminate({ kind: "throw", error: err });
        return;
      }
    }
    // A blocked operation whose record changed may proceed now. It leaves the blocked
    // set here, before checkIdle below. So the invocation does not suspend on it.
    for (const b of blocked) {
      if (state.get(b.id)?.Status === b.status) continue;
      blocked.delete(b);
      // An abandoned operation must not run again (README 2.9). It stays unresolved.
      if (b.isLive()) {
        refreshed = false;
        b.wake();
      }
    }
    for (const b of batch) b.resolve();
    schedule();
    checkIdle();
  }

  // Suspend when nothing can make progress without the service. The second check after
  // setImmediate lets already-resolved promises start the next operation first.
  // True if a live blocked operation passes the test.
  const someLive = (test = () => true) => {
    for (const b of blocked) if (b.isLive() && test(b)) return true;
    return false;
  };
  const idle = () =>
    !done &&
    running === 0 &&
    someLive() &&
    pending.length === 0 &&
    !scheduled &&
    !inFlight;
  function checkIdle() {
    if (!idle()) return;
    setImmediate(() => {
      if (!idle()) return;
      // The service can end a wait or a retry delay after the last checkpoint response.
      // PENDING with nothing pending is an invocation error on the service. So if a due
      // time has passed, one empty checkpoint reads the new records first. A refresh
      // that wakes nothing is not repeated, so the invocation then suspends.
      if (!refreshed && someLive((b) => isDue(state.get(b.id)))) {
        refreshed = true;
        // flush handles its own errors. It sends Updates: [] because nothing is pending.
        void flush();
      } else terminate({ kind: "pending" });
    });
  }

  return {
    arn,
    terminated,
    // The composed wrap of the plugins, or undefined (README 2.12).
    wrap,
    // The composed traceHeader of the plugins, or undefined (README 2.12).
    traceHeader,
    // A new array of the stored records, for the plugins.
    snapshot: () => [...state.values()],
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
    // The operation needs the service to act first. id is its hashed id. The promise
    // resolves when a checkpoint response changes the Status of that record. The
    // operation then reads its record again. isLive turns false when a batch abandons
    // the operation (README 2.9). Then the operation no longer counts as blocked,
    // and its promise never resolves.
    block(id, isLive = () => true) {
      const status = state.get(id)?.Status;
      const woken = new Promise((wake) => {
        blocked.add({ id, status, isLive, wake });
      });
      checkIdle();
      return woken;
    },
    fail(error) {
      terminate({ kind: "failed", error });
    },
    // The Lambda handler throws this error, so Lambda invokes again.
    abort(error) {
      terminate({ kind: "throw", error });
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
