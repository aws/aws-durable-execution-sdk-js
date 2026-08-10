/**
 * Runs the real checkpoint/replay engine on a runtime that lacks the two Node APIs lightweight
 * JavaScript runtimes tend not to implement, and asserts it behaves identically to one that has
 * them.
 *
 * Durable functions can be packaged as container images, so the runtime need not be a
 * Lambda-managed Node.js. LLRT is the case in point: `async_hooks` has no `AsyncLocalStorage`
 * and `node:util` has no `formatWithOptions`. The SDK falls back for both, and the unit tests
 * beside each fallback cover them in isolation. What those cannot show is that a whole
 * execution -- steps, a retry, a suspending wait, a child context, a parallel block -- still
 * produces the same checkpoints when the fallbacks are the ones in use.
 *
 * The absent capabilities are simulated with module mocks rather than by executing another
 * runtime, so this runs in-process with the rest of the suite: no runtime download, no
 * subprocess, no network.
 *
 * The assertion that matters is byte-identical checkpoint traffic between the two modes. Any
 * divergence there would mean an execution could not survive its runtime changing beneath it,
 * and it also pins the fallbacks to observability, which is the only thing they are allowed to
 * affect.
 */

import type {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
  OperationUpdate,
  WireOperation,
} from "./types/wire";

/** Fields whose values legitimately differ between two runs of the same execution. */
const CANONICALIZE_KEYS = new Set([
  "CheckpointToken",
  // Retry backoff carries jitter.
  "NextAttemptDelaySeconds",
  // Stack traces carry absolute paths and line numbers.
  "StackTrace",
]);

const canonicalize = (request: CheckpointDurableExecutionRequest): unknown =>
  JSON.parse(
    JSON.stringify(request, (key, value) =>
      CANONICALIZE_KEYS.has(key) ? `<${key}>` : value,
    ),
  );

const iso = (ms: number): string => new Date(ms).toISOString();

type HarnessOperation = WireOperation & { wakeAt?: number };

/**
 * In-memory stand-in for the durable execution service: applies checkpoint updates to an
 * operation history and hands it back, fast-forwarding waits and retry backoffs instead of
 * sleeping.
 *
 * The testing SDK's runner cannot be used here -- it needs `node:worker_threads` and fake
 * timers, and the point of this file is to stay inside one Jest process.
 */
class InMemoryDurableService {
  private now = Date.UTC(2026, 0, 1);
  private token = "token-0";
  private tokenSeq = 0;
  private readonly operations = new Map<string, HarnessOperation>();
  readonly checkpoints: unknown[] = [];
  readonly transitions: string[] = [];

  constructor(input: unknown) {
    this.operations.set("EXECUTION", {
      Id: "EXECUTION",
      Type: "EXECUTION",
      Status: "STARTED",
      StartTimestamp: iso(this.now),
      ExecutionDetails: { InputPayload: JSON.stringify(input) },
    } as HarnessOperation);
  }

  async getExecutionState(): Promise<GetDurableExecutionStateResponse> {
    return { Operations: this.wireOperations(), NextMarker: undefined };
  }

  async checkpoint(
    request: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse> {
    if (request.CheckpointToken !== this.token) {
      throw new Error(
        `stale checkpoint token ${request.CheckpointToken} (expected ${this.token})`,
      );
    }
    this.checkpoints.push(canonicalize(request));

    const changed: HarnessOperation[] = [];
    for (const update of request.Updates ?? []) {
      this.transitions.push(
        `${update.Action} ${update.Type}${update.SubType ? `/${update.SubType}` : ""} ${update.Name ?? ""}`.trim(),
      );
      changed.push(this.apply(update));
    }

    this.token = `token-${++this.tokenSeq}`;
    return {
      CheckpointToken: this.token,
      NewExecutionState: { Operations: changed.map(strip) },
    };
  }

  private apply(update: OperationUpdate): HarnessOperation {
    const id = update.Id as string;
    const operation: HarnessOperation = {
      StartTimestamp: iso(this.now),
      ...this.operations.get(id),
      Id: id,
      Type: update.Type,
      Name: update.Name ?? this.operations.get(id)?.Name,
      ParentId: update.ParentId ?? this.operations.get(id)?.ParentId,
      SubType: update.SubType ?? this.operations.get(id)?.SubType,
    } as HarnessOperation;

    const detailsKey =
      operation.Type === "CONTEXT"
        ? "ContextDetails"
        : operation.Type === "EXECUTION"
          ? "ExecutionDetails"
          : "StepDetails";

    switch (update.Action) {
      case "START":
        if (operation.Type === "WAIT") {
          const seconds = update.WaitOptions?.WaitSeconds ?? 0;
          operation.Status = "PENDING";
          operation.WaitDetails = {
            ScheduledEndTimestamp: iso(this.now + seconds * 1000),
          };
          operation.wakeAt = this.now + seconds * 1000;
        } else if (operation.Type === "CALLBACK") {
          operation.Status = "PENDING";
        } else {
          operation.Status = "STARTED";
        }
        break;
      case "SUCCEED":
        operation.Status = "SUCCEEDED";
        operation.EndTimestamp = iso(this.now);

        (operation as any)[detailsKey] = {
          ...(operation as any)[detailsKey],
          Result: update.Payload,
        };
        delete operation.wakeAt;
        break;
      case "FAIL":
        operation.Status = "FAILED";
        operation.EndTimestamp = iso(this.now);

        (operation as any)[detailsKey] = {
          ...(operation as any)[detailsKey],
          Error: update.Error,
        };
        delete operation.wakeAt;
        break;
      case "RETRY": {
        const delayMs =
          (update.StepOptions?.NextAttemptDelaySeconds ?? 0) * 1000;
        operation.Status = "PENDING";
        operation.StepDetails = {
          ...operation.StepDetails,
          Attempt: (operation.StepDetails?.Attempt ?? 0) + 1,
          NextAttemptTimestamp: iso(this.now + delayMs),
          Error: update.Error,
        };
        operation.wakeAt = this.now + delayMs;
        break;
      }
      default:
        throw new Error(`unhandled checkpoint action ${update.Action}`);
    }

    this.operations.set(id, operation);
    return operation;
  }

  /** Completes whatever the earliest scheduled wake-up unblocks, and reports which ids moved. */
  private advanceClock(): string[] {
    const scheduled = [...this.operations.values()].filter(
      (operation) => typeof operation.wakeAt === "number",
    );
    if (scheduled.length === 0) return [];

    this.now = Math.max(
      this.now,
      Math.min(...scheduled.map((o) => o.wakeAt as number)),
    );
    const woken: string[] = [];
    for (const operation of scheduled) {
      if ((operation.wakeAt as number) > this.now) continue;
      delete operation.wakeAt;
      if (operation.Type === "WAIT") {
        operation.Status = "SUCCEEDED";
        operation.EndTimestamp = iso(this.now);
      } else {
        operation.Status = "READY";
      }
      woken.push(operation.Id as string);
    }
    return woken;
  }

  private wireOperations(): WireOperation[] {
    return [...this.operations.values()].map(strip);
  }

  /**
   * Drives the handler until the execution is terminal, re-invoking it the way the service would
   * each time an invocation reports PENDING.
   */
  async run(
    handler: (event: unknown, context: unknown) => Promise<{ Status?: string }>,
    makeEvent: (input: {
      DurableExecutionArn: string;
      CheckpointToken: string;
      UpdatedOperationIds?: string[];
      InitialExecutionState: { Operations: WireOperation[] };
    }) => unknown,
  ): Promise<{ output: { Status?: string }; invocations: number }> {
    let updatedOperationIds: string[] | undefined;

    for (let attempt = 0; attempt < 25; attempt++) {
      const output = await handler(
        makeEvent({
          DurableExecutionArn:
            "arn:aws:lambda:us-east-1:000000000000:function:f:1/durable-execution/e/1",
          CheckpointToken: this.token,
          UpdatedOperationIds: updatedOperationIds,
          InitialExecutionState: { Operations: this.wireOperations() },
        }),
        {
          awsRequestId: `request-${attempt + 1}`,
          getRemainingTimeInMillis: () => 300_000,
        },
      );

      if (output?.Status !== "PENDING") {
        return { output, invocations: attempt + 1 };
      }

      updatedOperationIds = this.advanceClock();
      if (updatedOperationIds.length === 0) {
        return { output, invocations: attempt + 1 };
      }
    }
    throw new Error("execution did not reach a terminal state");
  }
}

const strip = (operation: HarnessOperation): WireOperation => {
  const { wakeAt: _wakeAt, ...rest } = operation;
  return rest;
};

/**
 * A `node:util` shaped like LLRT's: `format` present, `formatWithOptions` absent.
 *
 * `jest.requireActual` rather than `require`, which inside a mock factory would resolve back to
 * the mock and recurse.
 */
const partialUtil = (): unknown => {
  const real = jest.requireActual<typeof import("node:util")>("node:util");
  return {
    __esModule: true,
    default: { format: real.format, inherits: real.inherits },
  };
};

interface RunOutcome {
  status: string | undefined;
  result: unknown;
  invocations: number;
  transitions: string[];
  checkpoints: unknown[];
  warnings: string[];
}

/**
 * Loads a fresh copy of the SDK -- optionally with the two capabilities removed -- and runs one
 * execution of the same workflow through the in-memory service.
 */
async function runWorkflow({
  constrained,
}: {
  constrained: boolean;
}): Promise<RunOutcome> {
  jest.resetModules();

  if (constrained) {
    // LLRT exposes the low-level async_hooks surface but no AsyncLocalStorage.
    jest.doMock("async_hooks", () => ({}));
    jest.doMock("node:util", partialUtil);
  }

  // The SDK logs through its own `Console` instance. Mocking it both captures the records this
  // test asserts on and keeps the workflow's own logging out of the suite output.
  const records: string[] = [];
  const capture =
    (level: string) =>
    (...args: unknown[]): void => {
      records.push(`${level} ${args.map(String).join(" ")}`);
    };
  jest.doMock("node:console", () => ({
    Console: jest.fn().mockImplementation(() => ({
      info: capture("INFO"),
      debug: capture("DEBUG"),
      warn: capture("WARN"),
      error: capture("ERROR"),
    })),
  }));

  try {
    const sdk = await import("./index");
    const {
      withDurableExecution,
      createRetryStrategy,
      DurableExecutionInvocationInputWithClient,
    } = sdk;

    let attempts = 0;
    const handler = withDurableExecution(
      async (event: { userId: string }, ctx) => {
        ctx.logger.info("starting", { userId: event.userId });

        const validated = await ctx.step("validate", async (stepCtx) => {
          stepCtx.logger.debug("validating", event);
          return { ...event, validated: true };
        });

        // Fails once, exercising the RETRY checkpoint path and error serialization.
        const flaky = await ctx.step(
          "flaky",
          async () => {
            attempts++;
            if (attempts < 2) throw new Error("transient failure");
            return { attempts };
          },
          {
            retryStrategy: createRetryStrategy({
              maxAttempts: 3,
              initialDelay: { seconds: 1 },
            }),
          },
        );

        // Suspends, so the next invocation replays everything above.
        await ctx.wait({ seconds: 30 });

        const enriched = await ctx.runInChildContext(
          "enrich",
          async (childCtx) =>
            childCtx.step("lookup", async () => ({ tier: "gold" })),
        );

        const fanout = await ctx.parallel("fanout", [
          async (branch): Promise<number> =>
            branch.step("first", async () => 1),
          async (branch): Promise<number> =>
            branch.step("second", async () => 2),
        ]);
        const branchResults = fanout.succeeded().map((item) => item.result);

        ctx.logger.info("done", { validated, flaky, enriched, branchResults });

        return {
          validated,
          flaky,
          enriched,
          branchResults,
          sum: branchResults.reduce((a, b) => a + b, 0),
        };
      },
    );

    const service = new InMemoryDurableService({ userId: "user-1" });
    const { output, invocations } = await service.run(
      handler as never,
      (input) =>
        new DurableExecutionInvocationInputWithClient(
          input as never,
          service as never,
        ),
    );

    // The envelope carries the result as a JSON string.
    const raw = (output as { Result?: string }).Result;
    return {
      status: output.Status,
      result: raw === undefined ? undefined : JSON.parse(raw),
      invocations,
      transitions: service.transitions,
      checkpoints: service.checkpoints,
      warnings: records.filter((record) => record.startsWith("WARN")),
    };
  } finally {
    jest.dontMock("async_hooks");
    jest.dontMock("node:util");
    jest.dontMock("node:console");
    jest.resetModules();
  }
}

describe("execution on a runtime without AsyncLocalStorage or util.formatWithOptions", () => {
  let baseline: RunOutcome;
  let constrained: RunOutcome;

  beforeAll(async () => {
    baseline = await runWorkflow({ constrained: false });
    constrained = await runWorkflow({ constrained: true });
  });

  it("completes the execution", () => {
    expect(baseline.status).toBe("SUCCEEDED");
    expect(constrained.status).toBe("SUCCEEDED");
  });

  it("produces the same result", () => {
    expect(constrained.result).toEqual(baseline.result);
    expect(constrained.result).toMatchObject({
      flaky: { attempts: 2 },
      enriched: { tier: "gold" },
      branchResults: [1, 2],
      sum: 3,
    });
  });

  it("suspends and resumes the same number of times", () => {
    expect(baseline.invocations).toBeGreaterThan(1);
    expect(constrained.invocations).toBe(baseline.invocations);
  });

  it("records the same operation transitions", () => {
    expect(constrained.transitions).toEqual(baseline.transitions);
  });

  it("sends byte-identical checkpoint requests", () => {
    // Anything persisted in a checkpoint must not depend on the runtime's capabilities, or an
    // in-flight execution could not survive a runtime change.
    expect(constrained.checkpoints).toEqual(baseline.checkpoints);
  });

  it("announces the degraded context tracking, and only when degraded", () => {
    const mentions = (outcome: RunOutcome): string[] =>
      outcome.warnings.filter((line) => line.includes("AsyncLocalStorage"));

    expect(mentions(constrained)).toHaveLength(1);
    expect(mentions(baseline)).toHaveLength(0);
  });
});
