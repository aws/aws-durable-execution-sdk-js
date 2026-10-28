import type { Event as HistoryApiEvent } from "@aws-sdk/client-lambda";
import {
  buildInvocations,
  buildOperations,
  getExecution,
  isDurableExecutionArn,
  listDurableFunctions,
  listExecutions,
  regionFromExecutionArn,
  startExecution,
  stopExecution,
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
  });

  it.each([
    "",
    "not-an-arn",
    "arn:aws:lambda:us-east-1:123456789012:function:f",
    "arn:aws:lambda:us-east-1:123456789012:durable-execution:test",
    "arn:aws:s3:us-east-1:123456789012:function:f:1/durable-execution/e/i",
    `${ARN} trailing`,
    `${ARN}\n`,
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
          RetryDetails: { CurrentAttempt: 3 },
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
    expect(failed).toMatchObject({
      status: "FAILED",
      attempt: 3,
      payloadTruncated: true,
    });
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
          Error: { Payload: { ErrorMessage: "first try" } },
          RetryDetails: { CurrentAttempt: 1 },
        },
      },
      { EventType: "StepStarted", Id: "s", EventTimestamp: t(2) },
    ];
    const [op] = buildOperations(events);
    expect(op).toMatchObject({
      status: "RUNNING",
      startTime: t(0).toISOString(),
      attempt: 1,
    });
    expect(op.endTime).toBeUndefined();
    expect(op.durationMs).toBeUndefined();
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
    expect(detail.historyTruncated).toBeUndefined();
    expect(detail.historyError).toBeUndefined();
  });

  it("stops paging at the event cap and says so", async () => {
    const { ctx, calls } = fakeContext({
      GetDurableExecutionCommand: () => summary,
      GetDurableExecutionHistoryCommand: (input) => ({
        Events: Array.from({ length: input.MaxItems }, (_, i) => ({
          EventType: "StepStarted",
          Id: `s${i}`,
        })),
        NextMarker: "more",
      }),
    });
    const detail = await getExecution(ctx, ARN, { maxHistoryEvents: 3 });
    expect(detail.history).toHaveLength(3);
    expect(detail.historyTruncated).toBe(true);
    expect(
      calls.filter((c) => c.command === "GetDurableExecutionHistoryCommand"),
    ).toHaveLength(1);
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

  it("rejects a malformed ARN before calling AWS", async () => {
    const { ctx, calls } = fakeContext({});
    await expect(getExecution(ctx, "nope")).rejects.toThrow(
      /Not a durable execution ARN/,
    );
    await expect(stopExecution(ctx, "nope")).rejects.toThrow(
      /Not a durable execution ARN/,
    );
    expect(calls).toEqual([]);
  });
});

describe("listing and starting", () => {
  it("keeps only durable functions, across pages, sorted, with progress", async () => {
    const { ctx } = fakeContext({
      ListFunctionsCommand: (input) =>
        input.Marker
          ? { Functions: [{ FunctionName: "b", DurableConfig: {} }] }
          : {
              Functions: [
                { FunctionName: "plain" },
                { FunctionName: "c", DurableConfig: {}, Runtime: "nodejs22.x" },
              ],
              NextMarker: "m",
            },
    });
    const progress: string[][] = [];
    const fns = await listDurableFunctions(ctx, (p) =>
      progress.push(p.map((f) => f.name)),
    );
    expect(fns.map((f) => f.name)).toEqual(["b", "c"]);
    expect(progress).toEqual([["c"], ["b", "c"]]);
  });

  it("lists executions newest-first with durations and an optional marker", async () => {
    const { ctx, calls } = fakeContext({
      ListDurableExecutionsByFunctionCommand: () => ({
        DurableExecutions: [
          {
            DurableExecutionArn: ARN,
            DurableExecutionName: "order-1",
            Status: "SUCCEEDED",
            StartTimestamp: t(0),
            EndTimestamp: t(3),
          },
        ],
        NextMarker: "",
      }),
    });
    const res = await listExecutions(ctx, { functionName: "order-processor" });
    expect(calls[0].input).toMatchObject({ ReverseOrder: true, MaxItems: 50 });
    expect(res).toEqual({
      executions: [
        {
          arn: ARN,
          name: "order-1",
          status: "SUCCEEDED",
          startTime: t(0).toISOString(),
          endTime: t(3).toISOString(),
          durationMs: 3000,
        },
      ],
      nextMarker: undefined,
    });
  });

  it("starts asynchronously and rejects invalid JSON before invoking", async () => {
    const { ctx, calls } = fakeContext({
      InvokeCommand: () => ({ DurableExecutionArn: ARN }),
    });
    await expect(
      startExecution(ctx, { functionName: "f", payload: "{bad" }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
    const res = await startExecution(ctx, {
      functionName: "f",
      payload: ' {"a":1} ',
      executionName: " run-2 ",
    });
    expect(res.durableExecutionArn).toBe(ARN);
    expect(calls[0].input).toMatchObject({
      FunctionName: "f",
      Qualifier: "$LATEST",
      InvocationType: "Event",
      DurableExecutionName: "run-2",
    });
    expect(new TextDecoder().decode(calls[0].input.Payload)).toBe('{"a":1}');
  });

  it("stops in the ARN's region", async () => {
    const { ctx, calls } = fakeContext({
      StopDurableExecutionCommand: () => ({}),
    });
    await stopExecution(ctx, ARN);
    expect(calls).toEqual([
      {
        region: "us-west-2",
        command: "StopDurableExecutionCommand",
        input: { DurableExecutionArn: ARN },
      },
    ]);
  });
});
