import type { Event as HistoryApiEvent } from "@aws-sdk/client-lambda";
import {
  buildInvocations,
  buildOperations,
  getExecution,
  formatError,
  isDurableExecutionArn,
  regionFromExecutionArn,
  type LambdaContext,
} from "./lambdaExecutions";

const ARN =
  "arn:aws:lambda:us-west-2:123456789012:function:order-processor:$LATEST/durable-execution/order-1/23b8c1e9-3924-46de-beb1-3b9046685257";

const t = (s: number) => new Date(Date.UTC(2025, 0, 1, 0, 0, s));

/** A fake client that answers by command class name and records every call. */
function fakeContext(handlers: Record<string, (input: any) => unknown>) {
  const calls: { region: string; command: string; input: any }[] = [];
  const ctx: LambdaContext = {
    region: "us-east-1",
    credentials: async () => ({ accessKeyId: "a", secretAccessKey: "b" }),
    clientFor: (region) => ({
      send: async (cmd: { constructor: { name: string }; input: unknown }) => {
        const command = cmd.constructor.name;
        calls.push({ region, command, input: cmd.input });
        const h = handlers[command];
        if (!h) throw new Error(`unexpected ${command}`);
        return h(cmd.input);
      },
    }),
  };
  return { ctx, calls };
}

describe("isDurableExecutionArn / regionFromExecutionArn", () => {
  it("accepts execution ARNs across partitions and returns their region", () => {
    expect(isDurableExecutionArn(ARN)).toBe(true);
    expect(regionFromExecutionArn(ARN)).toBe("us-west-2");
    const cn =
      "arn:aws-cn:lambda:cn-north-1:123456789012:function:f:1/durable-execution/e/i";
    expect(isDurableExecutionArn(cn)).toBe(true);
    expect(regionFromExecutionArn(cn)).toBe("cn-north-1");
    // Without a qualifier.
    expect(
      isDurableExecutionArn(
        "arn:aws:lambda:us-east-1:123456789012:function:f/durable-execution/e/i",
      ),
    ).toBe(true);
  });

  it.each([
    "",
    "not-an-arn",
    "arn:aws:lambda:us-east-1:123456789012:function:f",
    "arn:aws:lambda:us-east-1:123456789012:durable-execution:test",
    "arn:aws:s3:us-east-1:123456789012:function:f:1/durable-execution/e/i",
    "arn:aws:lambda:us-east-1:123456789012:function:f:1/durable-execution/",
    "arn:aws:lambda:us-east-1:12345:function:f:1/durable-execution/e/i",
    "arn:aws:lambda:not a region:123456789012:function:f:1/durable-execution/e/i",
    "arn:aws:lambda::123456789012:function:f:1/durable-execution/e/i",
    `arn:aws:lambda:${"a".repeat(33)}:123456789012:function:f:1/durable-execution/e/i`,
    "arn:awsfoo:lambda:us-east-1:123456789012:function:f:1/durable-execution/e/i",
    "arx:aws:lambda:us-east-1:123456789012:function:f:1/durable-execution/e/i",
    "arn:aws:lambda:us-east-1:123456789012:layer:f:1/durable-execution/e/i",
    "arn:aws:lambda:us-east-1:123456789012:function::1/durable-execution/e/i",
    "arn:aws:lambda:us-east-1:123456789012:function/durable-execution/e/i",
    "arn:aws:lambda:us-east-1:123456789012:function:f:1:x/durable-execution/e/i",
  ])("rejects %j", (value) => {
    expect(isDurableExecutionArn(value)).toBe(false);
    expect(regionFromExecutionArn(value)).toBeUndefined();
  });

  it("rejects non-strings and over-long values", () => {
    expect(isDurableExecutionArn(42)).toBe(false);
    expect(isDurableExecutionArn(undefined)).toBe(false);
    expect(isDurableExecutionArn(`${ARN}${"x".repeat(3000)}`)).toBe(false);
  });
});

describe("buildOperations", () => {
  it("folds events into a sorted tree with status, result, and error", () => {
    const events: HistoryApiEvent[] = [
      { EventType: "ExecutionStarted", EventTimestamp: t(0), Id: "exec" },
      {
        EventType: "ContextStarted",
        SubType: "Map",
        Id: "m",
        Name: "items",
        EventTimestamp: t(1),
      },
      {
        EventType: "StepStarted",
        Id: "s2",
        ParentId: "m",
        Name: "second",
        EventTimestamp: t(3),
      },
      {
        EventType: "StepStarted",
        Id: "s1",
        ParentId: "m",
        Name: "first",
        EventTimestamp: t(2),
      },
      {
        EventType: "StepSucceeded",
        Id: "s1",
        EventTimestamp: t(4),
        StepSucceededDetails: {
          Result: { Payload: '{"ok":true}' },
          RetryDetails: undefined,
        },
      },
      {
        EventType: "StepFailed",
        Id: "s2",
        EventTimestamp: t(5),
        StepFailedDetails: {
          Error: {
            Payload: { ErrorType: "Boom", ErrorMessage: "bad", StackTrace: [] },
            Truncated: true,
          },
        },
      },
      { EventType: "InvocationCompleted", EventTimestamp: t(6) },
    ];
    const [map, ...rest] = buildOperations(events);
    expect(rest).toEqual([]);
    expect(map).toMatchObject({
      id: "m",
      name: "items",
      kind: "Map",
      status: "RUNNING",
    });
    expect(map.children?.map((c) => c.name)).toEqual(["first", "second"]);
    expect(map.children?.[0]).toMatchObject({
      status: "SUCCEEDED",
      result: '{"ok":true}',
      durationMs: 2000,
    });
    const failed = map.children?.[1];
    expect(failed).toMatchObject({ status: "FAILED", payloadTruncated: true });
    // One Started event is one attempt, so no attempt count is shown.
    expect(failed?.attempt).toBeUndefined();
    // An empty stack trace is omitted rather than printed as [].
    expect(JSON.parse(failed?.error ?? "")).toEqual({
      errorType: "Boom",
      errorMessage: "bad",
    });
  });

  it("re-opens an operation on a retry and keeps the first start time", () => {
    const events: HistoryApiEvent[] = [
      { EventType: "StepStarted", Id: "s", EventTimestamp: t(0) },
      {
        EventType: "StepFailed",
        Id: "s",
        EventTimestamp: t(1),
        StepFailedDetails: {
          Error: { Payload: { ErrorMessage: "first try" }, Truncated: true },
          RetryDetails: { NextAttemptDelaySeconds: 1 },
        },
      },
      { EventType: "StepStarted", Id: "s", EventTimestamp: t(2) },
    ];
    const [op] = buildOperations(events);
    // The retry is running, so it is no longer waiting for an attempt, and
    // the earlier attempt's truncated error no longer applies.
    expect(op.nextAttemptTime).toBeUndefined();
    expect(op.payloadTruncated).toBeUndefined();
    expect(op).toMatchObject({
      status: "RUNNING",
      startTime: t(0).toISOString(),
      attempt: 2,
    });
    expect(op.endTime).toBeUndefined();
    expect(op.durationMs).toBeUndefined();
    // The first attempt's error no longer describes the running attempt.
    expect(op.error).toBeUndefined();
  });

  it("records wait, callback, and chained-invoke details", () => {
    const ops = buildOperations([
      {
        EventType: "WaitStarted",
        Id: "w",
        EventTimestamp: t(0),
        WaitStartedDetails: { Duration: 60, ScheduledEndTimestamp: t(60) },
      },
      {
        EventType: "CallbackStarted",
        Id: "c",
        EventTimestamp: t(1),
        CallbackStartedDetails: { CallbackId: "cb-1" },
      },
      {
        EventType: "ChainedInvokeStarted",
        Id: "i",
        EventTimestamp: t(2),
        ChainedInvokeStartedDetails: {
          FunctionName: "child",
          DurableExecutionArn: ARN,
        },
      },
    ]);
    expect(ops.map((o) => o.kind)).toEqual([
      "Wait",
      "Callback",
      "ChainedInvoke",
    ]);
    expect(ops[0].scheduledEndTime).toBe(t(60).toISOString());
    expect(ops[1].callbackId).toBe("cb-1");
    expect(ops[2]).toMatchObject({
      invokedFunction: "child",
      invokedExecutionArn: ARN,
    });
  });

  it("keeps an operation whose parent is absent at the root", () => {
    const ops = buildOperations([
      {
        EventType: "StepStarted",
        Id: "orphan",
        ParentId: "gone",
        EventTimestamp: t(0),
      },
    ]);
    expect(ops.map((o) => o.id)).toEqual(["orphan"]);
  });
});

describe("buildInvocations", () => {
  it("returns one row per InvocationCompleted event", () => {
    expect(
      buildInvocations([
        { EventType: "StepStarted", Id: "s" },
        {
          EventType: "InvocationCompleted",
          InvocationCompletedDetails: {
            RequestId: "r1",
            StartTimestamp: t(0),
            EndTimestamp: t(2),
            Error: { Payload: { ErrorMessage: "timeout" } },
          },
        },
      ]),
    ).toEqual([
      {
        requestId: "r1",
        startTime: t(0).toISOString(),
        endTime: t(2).toISOString(),
        durationMs: 2000,
        error: JSON.stringify({ errorMessage: "timeout" }, null, 2),
      },
    ]);
  });
});

describe("getExecution", () => {
  const summary = {
    DurableExecutionArn: ARN,
    DurableExecutionName: "order-1",
    FunctionArn:
      "arn:aws:lambda:us-west-2:123456789012:function:order-processor:$LATEST",
    Status: "FAILED",
    StartTimestamp: t(0),
    EndTimestamp: t(10),
    InputPayload: '{"id":1}',
    Error: { ErrorType: "Boom", ErrorMessage: "bad" },
  };

  it("targets the ARN's region, pages history, and builds the tree", async () => {
    const pages = [
      {
        Events: [{ EventType: "StepStarted", Id: "s", EventTimestamp: t(1) }],
        NextMarker: "p2",
      },
      {
        Events: [{ EventType: "StepFailed", Id: "s", EventTimestamp: t(2) }],
      },
    ];
    const { ctx, calls } = fakeContext({
      GetDurableExecutionCommand: () => summary,
      GetDurableExecutionHistoryCommand: (input) =>
        input.Marker === "p2" ? pages[1] : pages[0],
    });
    const detail = await getExecution(ctx, ARN);
    expect(calls.every((c) => c.region === "us-west-2")).toBe(true);
    expect(calls.map((c) => c.input.Marker)).toEqual([
      undefined,
      undefined,
      "p2",
    ]);
    expect(detail).toMatchObject({
      arn: ARN,
      name: "order-1",
      status: "FAILED",
      durationMs: 10_000,
      input: '{"id":1}',
    });
    expect(JSON.parse(detail.error ?? "")).toEqual({
      errorType: "Boom",
      errorMessage: "bad",
    });
    expect(detail.history).toHaveLength(2);
    expect(detail.operations[0]).toMatchObject({ id: "s", status: "FAILED" });
    expect(detail.historyError).toBeUndefined();
  });

  it("reads every history page, in pages of 1000", async () => {
    const { ctx, calls } = fakeContext({
      GetDurableExecutionCommand: () => summary,
      GetDurableExecutionHistoryCommand: (input) => {
        const page = Number(input.Marker ?? 0);
        return {
          Events: Array.from({ length: 1000 }, (_, i) => ({
            EventType: "StepStarted",
            Id: `s${page * 1000 + i}`,
          })),
          // An empty marker on the last page ends the read, like none.
          NextMarker: page < 11 ? String(page + 1) : "",
        };
      },
    });
    const detail = await getExecution(ctx, ARN);
    const historyCalls = calls.filter(
      (c) => c.command === "GetDurableExecutionHistoryCommand",
    );
    expect(historyCalls).toHaveLength(12);
    expect(historyCalls.every((c) => c.input.MaxItems === 1000)).toBe(true);
    expect(detail.history).toHaveLength(12_000);
  });

  // A partial history would show finished operations as open, so a failed
  // page returns none of the history.
  it("returns no history when a later page fails", async () => {
    const { ctx } = fakeContext({
      GetDurableExecutionCommand: () => ({ ...summary, Status: "SUCCEEDED" }),
      GetDurableExecutionHistoryCommand: (input) => {
        if (input.Marker) throw new Error("Throttled");
        return {
          Events: [
            { EventType: "StepStarted", Id: "s", EventTimestamp: t(1) },
            { EventType: "InvocationCompleted", EventTimestamp: t(2) },
          ],
          NextMarker: "p2",
        };
      },
    });
    const detail = await getExecution(ctx, ARN);
    expect(detail.status).toBe("SUCCEEDED");
    expect(detail.historyError).toBe("Throttled");
    expect(detail.history).toEqual([]);
    expect(detail.operations).toEqual([]);
    expect(detail.invocations).toEqual([]);
  });

  it("marks operations INCOMPLETE when an ended execution left them open", async () => {
    const { ctx } = fakeContext({
      GetDurableExecutionCommand: () => ({ ...summary, Status: "SUCCEEDED" }),
      GetDurableExecutionHistoryCommand: () => ({
        Events: [{ EventType: "StepStarted", Id: "s", EventTimestamp: t(1) }],
      }),
    });
    const detail = await getExecution(ctx, ARN);
    expect(detail.operations[0].status).toBe("INCOMPLETE");
  });

  it("takes the result from the history's end when the summary still runs", async () => {
    const { ctx } = fakeContext({
      GetDurableExecutionCommand: () => ({
        DurableExecutionArn: ARN,
        Status: "RUNNING",
        StartTimestamp: t(0),
      }),
      GetDurableExecutionHistoryCommand: () => ({
        Events: [
          {
            EventType: "ExecutionSucceeded",
            Id: "x",
            EventTimestamp: t(4),
            ExecutionSucceededDetails: { Result: { Payload: '"done"' } },
          },
        ],
      }),
    });
    const detail = await getExecution(ctx, ARN);
    expect(detail).toMatchObject({ status: "SUCCEEDED", result: '"done"' });
  });

  it("does not take an operation's end as the execution's end", async () => {
    const { ctx } = fakeContext({
      GetDurableExecutionCommand: () => ({
        DurableExecutionArn: ARN,
        Status: "RUNNING",
        StartTimestamp: t(0),
      }),
      GetDurableExecutionHistoryCommand: () => ({
        Events: [
          { EventType: "StepStarted", Id: "s", EventTimestamp: t(1) },
          { EventType: "StepSucceeded", Id: "s", EventTimestamp: t(2) },
        ],
      }),
    });
    const detail = await getExecution(ctx, ARN);
    expect(detail.status).toBe("RUNNING");
    expect(detail.endTime).toBeUndefined();
  });

  it("reports a history failure without failing the call", async () => {
    const { ctx } = fakeContext({
      GetDurableExecutionCommand: () => summary,
      GetDurableExecutionHistoryCommand: () => {
        throw new Error("AccessDenied");
      },
    });
    const detail = await getExecution(ctx, ARN);
    expect(detail.status).toBe("FAILED");
    expect(detail.historyError).toBe("AccessDenied");
    expect(detail.operations).toEqual([]);
  });

  it("takes the end from the history when the summary was read before it", async () => {
    // The execution ended between the two reads: the summary still says
    // RUNNING, and the history already holds the end.
    const { ctx } = fakeContext({
      GetDurableExecutionCommand: () => ({
        DurableExecutionArn: ARN,
        Status: "RUNNING",
        StartTimestamp: t(0),
      }),
      GetDurableExecutionHistoryCommand: () => ({
        Events: [
          { EventType: "StepStarted", Id: "s", EventTimestamp: t(1) },
          {
            EventType: "ExecutionTimedOut",
            Id: "x",
            EventTimestamp: t(9),
            ExecutionTimedOutDetails: {
              Error: { Payload: { ErrorType: "Timeout" } },
            },
          },
        ],
      }),
    });
    const detail = await getExecution(ctx, ARN);
    expect(detail).toMatchObject({
      status: "TIMED_OUT",
      endTime: t(9).toISOString(),
      durationMs: 9000,
    });
    expect(JSON.parse(detail.error ?? "")).toEqual({ errorType: "Timeout" });
    expect(detail.operations[0].status).toBe("INCOMPLETE");
  });

  it("keeps a terminal summary status over the history", async () => {
    const { ctx } = fakeContext({
      GetDurableExecutionCommand: () => ({
        DurableExecutionArn: ARN,
        Status: "STOPPED",
        EndTimestamp: t(5),
      }),
      GetDurableExecutionHistoryCommand: () => ({
        Events: [
          { EventType: "ExecutionSucceeded", Id: "x", EventTimestamp: t(3) },
        ],
      }),
    });
    const detail = await getExecution(ctx, ARN);
    expect(detail.status).toBe("STOPPED");
    expect(detail.endTime).toBe(t(5).toISOString());
  });

  it("rejects a malformed ARN before calling AWS", async () => {
    const { ctx, calls } = fakeContext({});
    await expect(getExecution(ctx, "nope")).rejects.toThrow(
      /Not a durable execution ARN/,
    );
    expect(calls).toEqual([]);
  });
});

describe("getExecution with a real LambdaClient", () => {
  // No clientFor, so getExecution builds its own client. A local server
  // stands in for Lambda and records each request.
  it("signs for the ARN's region and reads summary and history", async () => {
    const { createServer } = await import("node:http");
    const requests: { path: string; auth: string }[] = [];
    const server = createServer((req, res) => {
      requests.push({
        path: req.url ?? "",
        auth: String(req.headers.authorization ?? ""),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        req.url?.includes("/history")
          ? JSON.stringify({
              Events: [
                { EventType: "StepStarted", Id: "s", EventTimestamp: 1 },
              ],
            })
          : JSON.stringify({ DurableExecutionArn: ARN, Status: "RUNNING" }),
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const prev = process.env.AWS_ENDPOINT_URL_LAMBDA;
    process.env.AWS_ENDPOINT_URL_LAMBDA = `http://127.0.0.1:${port}`;
    try {
      const detail = await getExecution(
        {
          region: "us-east-1",
          credentials: async () => ({ accessKeyId: "a", secretAccessKey: "b" }),
        },
        ARN,
      );
      expect(detail.status).toBe("RUNNING");
      expect(detail.operations.map((o) => o.id)).toEqual(["s"]);
      expect(requests).toHaveLength(2);
      // The ARN names us-west-2; the context's default region is not used.
      expect(requests.every((r) => r.auth.includes("/us-west-2/lambda/"))).toBe(
        true,
      );
    } finally {
      if (prev === undefined) delete process.env.AWS_ENDPOINT_URL_LAMBDA;
      else process.env.AWS_ENDPOINT_URL_LAMBDA = prev;
      server.close();
    }
  });
});

describe("buildOperations: retries and finished executions (#1118)", () => {
  const failed = (s: number, delay?: number, attempt = 1): HistoryApiEvent => ({
    EventType: "StepFailed",
    Id: "s",
    EventTimestamp: t(s),
    StepFailedDetails: {
      Error: { Payload: { ErrorType: "Boom", ErrorMessage: `try ${attempt}` } },
      RetryDetails: {
        CurrentAttempt: attempt,
        ...(delay !== undefined ? { NextAttemptDelaySeconds: delay } : {}),
      },
    },
  });
  const started = (s: number): HistoryApiEvent => ({
    EventType: "StepStarted",
    Id: "s",
    EventTimestamp: t(s),
  });

  it("shows a step waiting for its retry as PENDING with the next attempt time", () => {
    const [op] = buildOperations([started(0), failed(1, 30)]);
    expect(op).toMatchObject({
      status: "PENDING",
      nextAttemptTime: t(31).toISOString(),
    });
    // One attempt is not a retry, so no attempt count is shown.
    expect(op.attempt).toBeUndefined();
    expect(op.endTime).toBeUndefined();
    expect(op.durationMs).toBeUndefined();
    // The error of the attempt that is being retried stays visible.
    expect(JSON.parse(op.error ?? "")).toMatchObject({ errorMessage: "try 1" });
  });

  it("drops an earlier attempt's error once the step succeeds", () => {
    const [op] = buildOperations([
      started(0),
      failed(1, 30),
      started(31),
      {
        EventType: "StepSucceeded",
        Id: "s",
        EventTimestamp: t(32),
        StepSucceededDetails: {
          Result: { Payload: '"ok"' },
          RetryDetails: undefined,
        },
      },
    ]);
    expect(op).toMatchObject({
      status: "SUCCEEDED",
      attempt: 2,
      result: '"ok"',
      durationMs: 32_000,
    });
    expect(op.error).toBeUndefined();
    expect(op.nextAttemptTime).toBeUndefined();
  });

  it("shows the final failure, with no retry left, as FAILED", () => {
    const [op] = buildOperations([
      started(0),
      failed(1, 5),
      started(6),
      failed(7, undefined, 2),
    ]);
    expect(op).toMatchObject({
      status: "FAILED",
      attempt: 2,
      endTime: t(7).toISOString(),
    });
    expect(JSON.parse(op.error ?? "")).toMatchObject({ errorMessage: "try 2" });
  });

  it("marks operations still open in a finished execution as INCOMPLETE", () => {
    const [running, waiting] = buildOperations(
      [
        { EventType: "StepStarted", Id: "a", EventTimestamp: t(0) },
        { EventType: "StepStarted", Id: "b", EventTimestamp: t(1) },
        {
          EventType: "StepFailed",
          Id: "b",
          EventTimestamp: t(2),
          StepFailedDetails: {
            Error: { Payload: { ErrorMessage: "x" } },
            RetryDetails: { CurrentAttempt: 1, NextAttemptDelaySeconds: 10 },
          },
        },
      ],
      { executionEnded: true },
    );
    expect(running.status).toBe("INCOMPLETE");
    expect(waiting.status).toBe("INCOMPLETE");
    expect(waiting.nextAttemptTime).toBeUndefined();
  });

  // waitForCondition records a check whose condition is not met yet as a
  // StepSucceeded that schedules the next check.
  const unmetCheck = (s: number): HistoryApiEvent => ({
    EventType: "StepSucceeded",
    Id: "s",
    SubType: "WaitForCondition",
    EventTimestamp: t(s),
    StepSucceededDetails: {
      Result: { Payload: "1" },
      RetryDetails: { CurrentAttempt: 1, NextAttemptDelaySeconds: 5 },
    },
  });

  it("shows a waitForCondition between checks as PENDING", () => {
    const [op] = buildOperations([started(0), unmetCheck(1)]);
    expect(op).toMatchObject({
      status: "PENDING",
      nextAttemptTime: t(6).toISOString(),
      result: "1",
    });
    expect(op.endTime).toBeUndefined();
    expect(op.durationMs).toBeUndefined();
  });

  it("shows a waitForCondition left between checks in an ended execution as INCOMPLETE", () => {
    const [op] = buildOperations([started(0), unmetCheck(1)], {
      executionEnded: true,
    });
    expect(op.status).toBe("INCOMPLETE");
    expect(op.nextAttemptTime).toBeUndefined();
    expect(op.endTime).toBeUndefined();
  });

  it("treats a terminal execution event in the history as the end", () => {
    // The summary is read before the history, so it can still say RUNNING
    // after the history already holds the execution's end.
    const [op] = buildOperations([
      started(0),
      { EventType: "ExecutionTimedOut", Id: "x", EventTimestamp: t(9) },
    ]);
    expect(op.status).toBe("INCOMPLETE");
  });

  it.each([
    ["out of range", 1e20],
    ["negative out of range", -1e20],
    ["NaN", Number.NaN],
    ["a string", "x"],
    ["null", null],
  ])("ignores a next-attempt delay that is %s", (_name, delay) => {
    // A malformed delay must not fail the fold, and so the whole page.
    const [op] = buildOperations([
      started(0),
      {
        EventType: "StepSucceeded",
        Id: "s",
        EventTimestamp: t(1),
        StepSucceededDetails: {
          Result: { Payload: "1" },
          RetryDetails: { NextAttemptDelaySeconds: delay as any },
        },
      },
    ]);
    expect(op.status).toBe("SUCCEEDED");
    expect(op.nextAttemptTime).toBeUndefined();
  });

  it("reports no attempt count for operations that ran once", () => {
    const ops = buildOperations([
      { EventType: "WaitStarted", Id: "w", EventTimestamp: t(0) },
      { EventType: "WaitSucceeded", Id: "w", EventTimestamp: t(1) },
      { EventType: "CallbackStarted", Id: "c", EventTimestamp: t(0) },
    ]);
    expect(ops.map((o) => o.attempt)).toEqual([undefined, undefined]);
  });

  it.each([
    ["ChainedInvoke", "ChainedInvokeStopped", "STOPPED"],
    ["Wait", "WaitCancelled", "CANCELLED"],
  ])("reads %s end %s as %s", (kind, endType, status) => {
    const [op] = buildOperations([
      { EventType: `${kind}Started`, Id: "o", EventTimestamp: t(0) },
      { EventType: endType, Id: "o", EventTimestamp: t(1) },
    ]);
    expect(op).toMatchObject({ kind, status });
  });

  it("ignores an event type it does not know", () => {
    const [op] = buildOperations([
      started(0),
      { EventType: "StepPaused" as never, Id: "s", EventTimestamp: t(1) },
    ]);
    expect(op.status).toBe("RUNNING");
    expect(op.endTime).toBeUndefined();
  });

  it("schedules no next attempt for an event without a timestamp", () => {
    const [op] = buildOperations([
      started(0),
      {
        EventType: "StepFailed",
        Id: "s",
        StepFailedDetails: { RetryDetails: { NextAttemptDelaySeconds: 5 } },
      },
    ]);
    expect(op.status).toBe("FAILED");
    expect(op.nextAttemptTime).toBeUndefined();
  });
});

describe("formatError", () => {
  it("keeps the error data", () => {
    expect(
      JSON.parse(formatError({ ErrorType: "E", ErrorData: '{"code":7}' })),
    ).toEqual({ errorType: "E", errorData: '{"code":7}' });
  });
});
