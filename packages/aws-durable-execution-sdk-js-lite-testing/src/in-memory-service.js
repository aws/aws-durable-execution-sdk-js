// An in-memory stand-in for the durable execution service. It applies checkpoint updates
// like the service does and keeps a virtual clock in epoch seconds. It has no timers:
// time moves only when advance() or advanceBy() is called.
//
// The service can change a record while an invocation runs, for example when a wait
// ends. It then returns that record in the next checkpoint response. advanceBy() and
// boundary() can run during an invocation. So the service remembers the records they
// change, and the next checkpoint response includes them.

export const ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:workflow:$LATEST/durable-execution/local/run";
const EXECUTION_ID = "execution";
const DETAILS = {
  EXECUTION: "ExecutionDetails",
  STEP: "StepDetails",
  WAIT: "WaitDetails",
  CALLBACK: "CallbackDetails",
  CHAINED_INVOKE: "ChainedInvokeDetails",
  CONTEXT: "ContextDetails",
};
const clean = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
const clone = (op) => structuredClone(op);

// The API sends timestamps as epoch seconds. The Lambda invocation event sends them as
// epoch milliseconds, as observed in AWS. The event's state is converted, so tests see
// both forms as Lambda sends them.
const ms = (t) => (typeof t === "number" ? Math.round(t * 1000) : t);
function eventPage({ Operations, ...rest }) {
  return {
    ...rest,
    Operations: Operations?.map((op) => {
      if (op.StartTimestamp !== undefined)
        op.StartTimestamp = ms(op.StartTimestamp);
      if (op.EndTimestamp !== undefined) op.EndTimestamp = ms(op.EndTimestamp);
      if (op.StepDetails?.NextAttemptTimestamp !== undefined) {
        op.StepDetails.NextAttemptTimestamp = ms(
          op.StepDetails.NextAttemptTimestamp,
        );
      }
      if (op.WaitDetails?.ScheduledEndTimestamp !== undefined) {
        op.WaitDetails.ScheduledEndTimestamp = ms(
          op.WaitDetails.ScheduledEndTimestamp,
        );
      }
      return op;
    }),
  };
}
const INVALID = "InvalidParameterValueException";
// The members of an update that the service reads as strings.
const STRING_FIELDS =
  "Id ParentId Name Type SubType Action Payload Error.ErrorType Error.ErrorMessage Error.ErrorData".split(
    " ",
  );
// The string members whose length and characters the service checks, from the API
// reference of OperationUpdate. A value outside its pattern fails with ValidationException.
const ID = /^[a-zA-Z0-9-_]{1,64}$/;
const PATTERNS = {
  Id: ID,
  ParentId: ID,
  SubType: /^[a-zA-Z0-9-_]{1,32}$/,
  Name: /^[\x20-\x7E]{1,256}$/,
};
// The service's Payload limits in bytes. Other types have no limit here.
const PAYLOAD_LIMITS = {
  STEP: 262_144,
  CONTEXT: 262_144,
  CHAINED_INVOKE: 1_048_576,
};
// The service's limit on the raw HTTP request: 6 MiB plus 11 KiB of headers.
const MAX_BODY_BYTES = 6_302_720;

export function createInMemoryService({
  input,
  onCallback,
  functions = {},
  pageSize,
} = {}) {
  let now = 1_700_000_000;
  let tokens = 0;
  let token;
  let callbacks = 0;
  let completed = false;
  let result; // the EXECUTION SUCCEED Payload (the large-result path)
  // Outcomes from "outside" (callback responses, finished invokes). They land when
  // boundary() runs: between invocations, or during one when a test calls it.
  let outcomes = [];
  const deadlines = new Map(); // callback op id -> timeout time
  // Records changed outside a checkpoint since the last response or invocation start.
  const changed = new Set();
  const ops = new Map(); // insertion order is start order
  ops.set(EXECUTION_ID, {
    Id: EXECUTION_ID,
    Type: "EXECUTION",
    StartTimestamp: now,
    Status: "STARTED",
    ExecutionDetails: clean({ InputPayload: JSON.stringify(input) }),
  });

  const merge = (op, fields) => {
    const key = DETAILS[op.Type];
    op[key] = clean({ ...op[key], ...fields });
  };
  const finish = (op, Status, fields = {}) => {
    op.Status = Status;
    op.EndTimestamp = now;
    merge(op, fields);
    changed.add(op);
  };

  function checkToken(t) {
    if (t === token && !completed) return;
    throw Object.assign(new Error("Invalid checkpoint token"), {
      name: "InvalidParameterValueException",
      status: 400,
    });
  }

  // Type-specific work when an operation is first created.
  function onCreate(op, u) {
    if (op.Type === "WAIT") {
      merge(op, {
        ScheduledEndTimestamp: now + (u.WaitOptions?.WaitSeconds ?? 0),
      });
    } else if (op.Type === "CALLBACK") {
      const CallbackId = `callback-${++callbacks}`;
      merge(op, { CallbackId });
      // The service treats a timeout of 0 like no timeout.
      const timeout = u.CallbackOptions?.TimeoutSeconds;
      if (timeout > 0) deadlines.set(op.Id, now + timeout);
      const name = op.Name;
      outcomes.push(
        Promise.resolve()
          .then(() => onCallback?.({ callbackId: CallbackId, name }))
          .then((out) => {
            if (out?.error) return [op, "FAILED", { Error: out.error }];
            if (out && "result" in out) {
              return [op, "SUCCEEDED", { Result: out.result }];
            }
          }),
      );
    } else if (op.Type === "CHAINED_INVOKE") {
      const fnName = u.ChainedInvokeOptions?.FunctionName;
      const fn = functions[fnName];
      outcomes.push(
        Promise.resolve()
          .then(() => {
            if (!fn) {
              throw Object.assign(new Error(`Function not found: ${fnName}`), {
                name: "ResourceNotFoundException",
              });
            }
            // The service gives XAmznTraceId to the invoked function as its trace
            // header. The local function receives it as traceHeader.
            return fn({
              input: JSON.parse(u.Payload ?? "{}"),
              traceHeader: u.ChainedInvokeOptions?.XAmznTraceId,
            });
          })
          .then(
            (value) => [op, "SUCCEEDED", { Result: JSON.stringify(value) }],
            (err) => [
              op,
              "FAILED",
              { Error: { ErrorType: err?.name, ErrorMessage: err?.message } },
            ],
          ),
      );
    } else if (op.Type === "CONTEXT") {
      // The service ignores ContextOptions on START.
      op.ContextDetails = {};
    }
  }

  // A lean subset of the service's checks (the simulated service's checkpoint-server
  // validators), so local tests fail where the service would reject a request. The
  // service checks every update against the state before the request, then applies them.
  function validate(updates) {
    const reject = (name, message) => {
      throw Object.assign(new Error(message), { name, status: 400 });
    };
    for (const u of updates) {
      for (const path of STRING_FIELDS) {
        const v = path.split(".").reduce((o, key) => o?.[key], u);
        if (v != null && typeof v !== "string") {
          reject("SerializationException", `${path} must be a string`);
        }
      }
      for (const [member, pattern] of Object.entries(PATTERNS)) {
        if (u[member] != null && !pattern.test(u[member])) {
          reject("ValidationException", `${member} must match ${pattern}`);
        }
      }
    }
    const seen = new Map();
    for (const u of updates) {
      const limit = PAYLOAD_LIMITS[u.Type];
      if (u.Payload != null && Buffer.byteLength(u.Payload) > limit) {
        reject(INVALID, `${u.Type} payload is larger than ${limit} bytes`);
      }
      const prev = seen.get(u.Id);
      const pair = prev?.Action === "START" && u.Action !== "START";
      if (
        prev &&
        !(pair && (prev.Type === "STEP" || prev.Type === "CONTEXT"))
      ) {
        reject(INVALID, `Cannot update operation ${u.Id} twice in one request`);
      }
      seen.set(u.Id, u);
      // Only a STEP waiting for its next attempt can start again.
      const op = u.Type === "EXECUTION" ? undefined : ops.get(u.Id);
      if (
        u.Action === "START" &&
        op &&
        !(op.Type === "STEP" && op.Status === "READY")
      ) {
        reject(
          INVALID,
          `Cannot start ${op.Type} ${u.Id} in status ${op.Status}`,
        );
      }
    }
  }

  function apply(u) {
    // Any EXECUTION update refers to the execution itself, whatever its id.
    if (u.Type === "EXECUTION") {
      const op = ops.get(EXECUTION_ID);
      completed = true;
      if (u.Action === "SUCCEED") result = u.Payload;
      finish(op, u.Action === "SUCCEED" ? "SUCCEEDED" : "FAILED");
      return op;
    }
    let op = ops.get(u.Id);
    if (!op) {
      op = clean({
        Id: u.Id,
        ParentId: u.ParentId,
        Name: u.Name,
        Type: u.Type,
        SubType: u.SubType,
        StartTimestamp: now,
        Status: "STARTED",
      });
      ops.set(u.Id, op);
      onCreate(op, u);
    }
    // Like the service: START keeps Attempt; SUCCEED, FAIL and RETRY finish an attempt.
    const attempt =
      op.Type === "STEP" ? (op.StepDetails?.Attempt ?? 0) + 1 : undefined;
    const fields = { Attempt: attempt, Result: u.Payload, Error: u.Error };
    if (u.Action === "START") op.Status = "STARTED";
    else if (u.Action === "SUCCEED" || u.Action === "FAIL") {
      if (op.Type === "CONTEXT") {
        // The service records ReplayChildren from the closing update only.
        fields.ReplayChildren = u.ContextOptions?.ReplayChildren === true;
      }
      finish(op, u.Action === "SUCCEED" ? "SUCCEEDED" : "FAILED", fields);
    } else if (u.Action === "RETRY") {
      op.Status = "PENDING";
      merge(op, {
        ...fields,
        NextAttemptTimestamp:
          now + (u.StepOptions?.NextAttemptDelaySeconds ?? 0),
      });
    }
    return op;
  }

  // The service omits descendants of a completed CONTEXT unless it set ReplayChildren.
  // The SDK replays such a context from its own result.
  const prunes = (op) =>
    op.Type === "CONTEXT" &&
    (op.Status === "SUCCEEDED" || op.Status === "FAILED") &&
    op.ContextDetails?.ReplayChildren !== true;
  function visible() {
    return [...ops.values()]
      .filter((op) => {
        for (let p = ops.get(op.ParentId); p; p = ops.get(p.ParentId)) {
          if (prunes(p)) return false;
        }
        return true;
      })
      .map(clone);
  }

  function page(marker, size) {
    const all = visible();
    const start = Number(marker ?? 0);
    const end = size ? start + size : all.length;
    return clean({
      Operations: all.slice(start, end),
      NextMarker: end < all.length ? String(end) : undefined,
    });
  }

  // Each item: [op, status, fields] or undefined (a callback that stays open).
  const dueItems = () => {
    const items = [];
    for (const op of ops.values()) {
      if (op.Type === "STEP" && op.Status === "PENDING") {
        items.push([op.StepDetails.NextAttemptTimestamp, op, "READY"]);
      } else if (op.Type === "WAIT" && op.Status === "STARTED") {
        items.push([op.WaitDetails.ScheduledEndTimestamp, op, "SUCCEEDED"]);
      } else if (op.Status === "STARTED" && deadlines.has(op.Id)) {
        items.push([deadlines.get(op.Id), op, "TIMED_OUT"]);
      }
    }
    return items;
  };

  function applyDue(items) {
    for (const [t, op, status] of items) {
      if (t > now) continue;
      if (status === "READY") {
        op.Status = "READY";
        changed.add(op);
      } else if (status === "SUCCEEDED") finish(op, status);
      else {
        finish(op, status, { Error: { ErrorMessage: "Callback timed out" } });
      }
    }
  }

  return {
    ops,
    get now() {
      return now;
    },
    get result() {
      return result;
    },
    client: {
      async checkpoint(request) {
        const { CheckpointToken, Updates = [] } = request;
        checkToken(CheckpointToken);
        // The client adds a 36-character ClientToken when the request has none.
        const body = JSON.stringify({
          ClientToken: "0".repeat(36),
          ...request,
        });
        if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
          throw Object.assign(
            new Error(`Request must be smaller than ${MAX_BODY_BYTES} bytes`),
            { name: "RequestEntityTooLargeException", status: 413 },
          );
        }
        validate(Updates);
        // finish() adds to changed too. So the set holds the applied updates and the
        // records that changed since the last response, each once.
        for (const u of Updates) changed.add(apply(u));
        const Operations = [...changed].map(clone);
        changed.clear();
        token = `token-${++tokens}`;
        return { CheckpointToken: token, NewExecutionState: { Operations } };
      },
      async getExecutionState({ CheckpointToken, Marker, MaxItems }) {
        checkToken(CheckpointToken);
        return page(Marker, pageSize ?? MaxItems);
      },
    },
    // The input for a new invocation. Each invocation gets a fresh token.
    // UpdatedOperationIds: the records that changed after the last checkpoint response,
    // for example a wait that the clock ended. The EXECUTION record is left out: only
    // complete() changes it, from the previous invocation's own output.
    event() {
      const UpdatedOperationIds = [...changed]
        .filter((op) => op.Type !== "EXECUTION")
        .map((op) => op.Id);
      // The initial state holds every record.
      changed.clear();
      token = `token-${++tokens}`;
      return {
        DurableExecutionArn: ARN,
        CheckpointToken: token,
        InitialExecutionState: eventPage(page(undefined, pageSize)),
        UpdatedOperationIds,
      };
    },
    // Applies outside outcomes that arrived since the last boundary. Returns how many.
    async boundary() {
      const settled = await Promise.all(outcomes);
      outcomes = [];
      const applied = settled.filter(Boolean);
      for (const [op, status, fields] of applied) {
        // A callback may have timed out before its response arrived.
        if (op.Status === "STARTED") finish(op, status, fields);
      }
      return applied.length;
    },
    // Moves the clock to the earliest due time and applies everything due by then.
    // Returns false when nothing is scheduled, so time cannot change anything.
    advance() {
      const items = dueItems();
      if (items.length === 0) return false;
      now = Math.max(now, Math.min(...items.map(([t]) => t)));
      applyDue(items);
      return true;
    },
    // Moves the clock forward by seconds and applies everything due by then. A test can
    // call it during an invocation. The next checkpoint response then reports the
    // changed records, like the service does.
    advanceBy(seconds) {
      now += seconds;
      applyDue(dueItems());
    },
    // True if some record waits for the service or an outside system: a wait or a
    // callback that has not ended, a scheduled step retry, or an invoke that has not
    // finished. The service records an invocation error when an invocation returns
    // PENDING while this is false.
    hasPending() {
      return [...ops.values()].some(
        (op) =>
          (op.Status === "STARTED" &&
            (op.Type === "WAIT" ||
              op.Type === "CALLBACK" ||
              op.Type === "CHAINED_INVOKE")) ||
          (op.Type === "STEP" && op.Status === "PENDING"),
      );
    },
    // Records the invocation's final output on the EXECUTION operation.
    complete(output) {
      const op = ops.get(EXECUTION_ID);
      // A PENDING output leaves the execution open for the next invocation.
      if (op.Status === "STARTED" && output.Status !== "PENDING")
        finish(op, output.Status);
    },
  };
}
