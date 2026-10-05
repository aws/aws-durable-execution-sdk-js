import type { Context } from "aws-lambda";
import {
  withDurableExecution,
  DurableExecutionInvocationInputWithClient,
  DurableExecutionClient,
  DurableExecutionClientError,
  DurableExecutionClientErrorScope,
  DurableInstrumentationPlugin,
  DurableContext,
  PropagationInput,
  OperationSubType,
  OperationType,
  OperationStatus,
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  WireOperation,
} from "../../index";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

const executionArn =
  "arn:aws:lambda:us-east-1:123456789012:function:parent:1/durable-execution/test/1";
const header =
  "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1";
const lambdaContext: Context = {
  awsRequestId: "request",
  getRemainingTimeInMillis: () => 0,
  callbackWaitsForEmptyEventLoop: false,
  functionName: "parent",
  functionVersion: "1",
  invokedFunctionArn: "parent:1",
  memoryLimitInMB: "128",
  logGroupName: "group",
  logStreamName: "stream",
  done() {},
  fail() {},
  succeed() {},
};

// Only the service boundary is faked: invoke, plugin dispatch, batching, hashing,
// payload serialization, checkpointing and replay all run through the public SDK.
class InvokeService implements DurableExecutionClient {
  readonly requests: CheckpointDurableExecutionRequest[] = [];
  readonly operations: WireOperation[] = [
    {
      Id: hashId("execution"),
      Type: OperationType.EXECUTION,
      Status: OperationStatus.STARTED,
      StartTimestamp: new Date("2026-01-01"),
      ExecutionDetails: { InputPayload: "{}" },
    },
  ];
  failStart = false;
  pending = false;
  async getExecutionState() {
    return { Operations: this.operations };
  }
  async checkpoint(
    request: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse> {
    // Round-trip the actual owned wire model across the service boundary.
    this.requests.push(JSON.parse(JSON.stringify(request)));
    if (
      this.failStart &&
      request.Updates?.some((u) => u.Type === OperationType.CHAINED_INVOKE)
    ) {
      throw new DurableExecutionClientError("uncommitted START", {
        scope: DurableExecutionClientErrorScope.INVOCATION,
      });
    }
    const changed: WireOperation[] = [];
    for (const update of request.Updates ?? []) {
      const operation: WireOperation = {
        Id: update.Id,
        Type: update.Type,
        SubType: update.SubType,
        Name: update.Name,
        ParentId: update.ParentId,
        StartTimestamp: new Date("2026-01-01"),
        Status:
          (update.Type === OperationType.CHAINED_INVOKE && !this.pending) ||
          update.Action === "SUCCEED"
            ? OperationStatus.SUCCEEDED
            : OperationStatus.STARTED,
        ...(update.Type === OperationType.CHAINED_INVOKE && {
          ChainedInvokeDetails: { Result: update.Payload },
        }),
        ...(update.Type === OperationType.CONTEXT && {
          ContextDetails: { Result: update.Payload },
        }),
      };
      const index = this.operations.findIndex((o) => o.Id === operation.Id);
      if (index < 0) this.operations.push(operation);
      else this.operations[index] = operation;
      changed.push(operation);
    }
    return {
      CheckpointToken: "next",
      NewExecutionState: { Operations: changed },
    };
  }
  get starts() {
    return this.requests
      .flatMap((r) => r.Updates ?? [])
      .filter((u) => u.Type === OperationType.CHAINED_INVOKE);
  }
  run(
    handler: (event: unknown, ctx: DurableContext) => Promise<unknown>,
    plugins: DurableInstrumentationPlugin[] = [],
  ) {
    return withDurableExecution(handler, { plugins })(
      new DurableExecutionInvocationInputWithClient(
        {
          DurableExecutionArn: executionArn,
          CheckpointToken: "token",
          InitialExecutionState: { Operations: this.operations },
        },
        this,
      ),
      lambdaContext,
    );
  }
}

const invoke = async (_: unknown, ctx: DurableContext) =>
  ctx.invoke("call", "callee:1", { input: "original" }, { tenantId: "tenant" });

describe("invoke START propagation through the public SDK", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("collects the stable identity before serializing the START and preserves the request", async () => {
    const service = new InvokeService();
    const provide = jest.fn((_input: PropagationInput) => ({
      xAmznTraceId: header,
    }));
    const result = await service.run(invoke, [
      { providePropagationMetadata: provide },
    ]);
    expect(result).toMatchObject({
      Status: "SUCCEEDED",
      Result: '{"input":"original"}',
    });
    expect(provide).toHaveBeenCalledTimes(1);
    expect(provide).toHaveBeenCalledWith({
      executionArn,
      operationId: hashId("1"),
      targetFunctionName: "callee:1",
    });
    expect(Object.isFrozen(provide.mock.calls[0][0])).toBe(true);
    expect(service.starts).toEqual([
      {
        Id: hashId("1"),
        Name: "call",
        Action: "START",
        Type: "CHAINED_INVOKE",
        SubType: OperationSubType.CHAINED_INVOKE,
        Payload: '{"input":"original"}',
        ChainedInvokeOptions: {
          FunctionName: "callee:1",
          TenantId: "tenant",
          XAmznTraceId: header,
        },
      },
    ]);
  });

  it.each<{ name: string; plugins: DurableInstrumentationPlugin[] }>([
    { name: "no plugins", plugins: [] },
    { name: "absent hook", plugins: [{}] },
    {
      name: "undefined metadata",
      plugins: [{ providePropagationMetadata: () => undefined }],
    },
    {
      name: "empty metadata",
      plugins: [{ providePropagationMetadata: () => ({}) }],
    },
    {
      name: "throwing hook",
      plugins: [
        {
          providePropagationMetadata: () => {
            throw new Error("instrumentation failed");
          },
        },
      ],
    },
  ])(
    "omits the wire member for $name without affecting the invoke",
    async ({ plugins }) => {
      const service = new InvokeService();
      expect(await service.run(invoke, plugins)).toMatchObject({
        Status: "SUCCEEDED",
        Result: '{"input":"original"}',
      });
      expect(service.starts[0].ChainedInvokeOptions).toEqual({
        FunctionName: "callee:1",
        TenantId: "tenant",
      });
      expect(service.starts[0].Payload).toBe('{"input":"original"}');
    },
  );

  it.each(["", " \t\n"])(
    "omits a blank contribution (%j) and allows a later healthy provider",
    async (blank) => {
      const service = new InvokeService();
      const emptyPlugin = {
        providePropagationMetadata: () => ({ xAmznTraceId: blank }),
      };
      expect(await service.run(invoke, [emptyPlugin])).toMatchObject({
        Status: "SUCCEEDED",
      });
      expect(service.starts[0].ChainedInvokeOptions).not.toHaveProperty(
        "XAmznTraceId",
      );
      const withHealthy = new InvokeService();
      expect(
        await withHealthy.run(invoke, [
          emptyPlugin,
          {
            providePropagationMetadata: () => ({ xAmznTraceId: header }),
          },
        ]),
      ).toMatchObject({ Status: "SUCCEEDED" });
      expect(withHealthy.starts[0].ChainedInvokeOptions?.XAmznTraceId).toBe(
        header,
      );
    },
  );

  it("preserves a nonblank opaque header without trimming or parsing it", async () => {
    const service = new InvokeService();
    const opaque = "  extension=value;Root=opaque  ";
    await service.run(invoke, [
      { providePropagationMetadata: () => ({ xAmznTraceId: opaque }) },
    ]);
    expect(service.starts[0].ChainedInvokeOptions?.XAmznTraceId).toBe(opaque);
  });

  it("isolates a failed provider and keeps the first healthy value", async () => {
    const service = new InvokeService();
    await service.run(invoke, [
      {
        providePropagationMetadata() {
          throw new Error("broken");
        },
      },
      { providePropagationMetadata: () => ({ xAmznTraceId: header }) },
      { providePropagationMetadata: () => ({ xAmznTraceId: "later" }) },
    ]);
    expect(service.starts[0].ChainedInvokeOptions?.XAmznTraceId).toBe(header);
    expect(warn).toHaveBeenCalled();
  });

  it("uses the hashed child identity and keeps distinct metadata in one batch", async () => {
    const service = new InvokeService();
    const inputs: unknown[] = [];
    await service.run(
      async (_, ctx) =>
        ctx.runInChildContext("child", async (child) => {
          const first = child.invoke("first", "first:1", { n: 1 });
          const second = child.invoke("second", "second:1", { n: 2 });
          return child.promise.all([first, second]);
        }),
      [
        {
          providePropagationMetadata(input) {
            inputs.push(input);
            return { xAmznTraceId: `parent=${input.operationId}` };
          },
        },
      ],
    );
    expect(inputs).toEqual(
      ["1-1", "1-2"].map((id, i) => ({
        executionArn,
        operationId: hashId(id),
        parentOperationId: hashId("1"),
        targetFunctionName: `${i === 0 ? "first" : "second"}:1`,
      })),
    );
    const batch = service.requests.find(
      (r) =>
        r.Updates?.filter((u) => u.Type === OperationType.CHAINED_INVOKE)
          .length === 2,
    );
    expect(batch).toBeDefined();
    expect(service.starts.map((u) => u.ChainedInvokeOptions)).toEqual([
      { FunctionName: "first:1", XAmznTraceId: `parent=${hashId("1-1")}` },
      { FunctionName: "second:1", XAmznTraceId: `parent=${hashId("1-2")}` },
    ]);
  });

  it.each([
    OperationStatus.SUCCEEDED,
    OperationStatus.FAILED,
    OperationStatus.TIMED_OUT,
    OperationStatus.STOPPED,
  ])(
    "replays %s without recomputing metadata or submitting another START",
    async (status) => {
      const service = new InvokeService();
      service.operations.push({
        Id: hashId("1"),
        Name: "call",
        Type: OperationType.CHAINED_INVOKE,
        SubType: OperationSubType.CHAINED_INVOKE,
        Status: status,
        StartTimestamp: new Date("2026-01-01"),
        ChainedInvokeDetails:
          status === OperationStatus.SUCCEEDED
            ? { Result: '{"stored":"outcome"}' }
            : { Error: { ErrorMessage: "stored failure" } },
      });
      const provide = jest.fn((_input: PropagationInput) => ({
        xAmznTraceId: "must not run",
      }));
      const result = await service.run(invoke, [
        { providePropagationMetadata: provide },
      ]);
      if (status === OperationStatus.SUCCEEDED)
        expect(result).toMatchObject({
          Status: "SUCCEEDED",
          Result: '{"stored":"outcome"}',
        });
      else
        expect(result).toMatchObject({
          Status: "FAILED",
          Error: { ErrorMessage: "stored failure" },
        });
      expect(provide).not.toHaveBeenCalled();
      expect(service.starts).toHaveLength(0);
    },
  );

  it("does not recompute on a pending START replay, and resumes with the stored result", async () => {
    const service = new InvokeService();
    service.pending = true;
    const provide = jest.fn((_input: PropagationInput) => ({
      xAmznTraceId: header,
    }));
    const plugins = [{ providePropagationMetadata: provide }];
    expect(await service.run(invoke, plugins)).toMatchObject({
      Status: "PENDING",
    });
    expect(await service.run(invoke, plugins)).toMatchObject({
      Status: "PENDING",
    });
    const operation = service.operations.find(
      (o) => o.Type === OperationType.CHAINED_INVOKE,
    )!;
    operation.Status = OperationStatus.SUCCEEDED;
    operation.ChainedInvokeDetails = { Result: '{"stored":"finished"}' };
    expect(await service.run(invoke, plugins)).toMatchObject({
      Status: "SUCCEEDED",
      Result: '{"stored":"finished"}',
    });
    expect(provide).toHaveBeenCalledTimes(1);
    expect(service.starts).toHaveLength(1);
  });

  it("recomputes after an uncommitted START failure with the same stable identity", async () => {
    const service = new InvokeService();
    const provide = jest.fn((_input: PropagationInput) => ({
      xAmznTraceId: header,
    }));
    const plugins = [{ providePropagationMetadata: provide }];
    service.failStart = true;
    await expect(service.run(invoke, plugins)).rejects.toThrow(
      /Checkpoint failed/,
    );
    expect(service.operations).toHaveLength(1);
    service.failStart = false;
    expect(await service.run(invoke, plugins)).toMatchObject({
      Status: "SUCCEEDED",
    });
    expect(provide).toHaveBeenCalledTimes(2);
    expect(provide.mock.calls[0]).toEqual(provide.mock.calls[1]);
    expect(service.starts).toHaveLength(2);
    expect(service.starts[0]).toEqual(service.starts[1]);
  });
});
