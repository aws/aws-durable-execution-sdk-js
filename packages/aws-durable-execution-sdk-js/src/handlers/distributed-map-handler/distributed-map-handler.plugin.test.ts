import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  type Mock,
  type Mocked,
} from "vitest";
import { createDistributedMapHandler } from "./distributed-map-handler";
import {
  DistributedMapProcessor,
  DurableExecutionClient,
  ExecutionContext,
  OperationSubType,
} from "../../types";
import {
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  WireOperation,
} from "../../types/wire";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import {
  DurableInstrumentationPlugin,
  OperationInfo,
} from "../../types/plugin";
import { DistributedMapError } from "../../errors/durable-error/durable-error";
import { Context } from "aws-lambda";
import { withDurableExecution } from "../../with-durable-execution";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

// The counts the service sends at every terminal state. TotalCount is required for SUCCEEDED.
const COUNTS = {
  SuccessCount: 0,
  FailureCount: 0,
  ReadCount: 0,
  TotalCount: 0,
};

vi.mock("../../utils/logger/logger");

describe("Distributed map handler - plugin hooks", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let createStepId: () => string;
  let mockPlugin: Mocked<DurableInstrumentationPlugin>;
  const processor = DistributedMapProcessor.reportBatchOutcome("proc-fn");

  const succeededDetails = {
    ...COUNTS,
    Status: "SUCCEEDED",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      getStepData: vi.fn().mockReturnValue(null),
      terminationManager: {
        terminate: vi.fn(),
        isTerminationRequested: vi.fn().mockReturnValue(false),
      },
      durableExecutionArn: "test-arn",
      isOperationUpdatedBetweenInvocation: vi.fn().mockReturnValue(false),
    } as any;
    mockCheckpoint = {
      checkpoint: vi.fn().mockResolvedValue(undefined),
      markOperationState: vi.fn(),
      markOperationAwaited: vi.fn(),
      waitForStatusChange: vi.fn().mockResolvedValue(undefined),
    } as any;
    createStepId = vi.fn().mockReturnValue("step-1");
    mockPlugin = {
      onOperationStart: vi.fn(),
      onOperationEnd: vi.fn(),
      onOperationAttemptStart: vi.fn(),
      onOperationAttemptEnd: vi.fn(),
    };
  });

  const makeHandler = () =>
    createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      vi.fn(),
      undefined,
      mockPlugin,
    );

  it("calls onOperationEnd with no error on a replay-succeeded operation", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      DistributedMapDetails: succeededDetails,
    });

    await makeHandler()([], processor, 2);

    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: true }),
    );
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() }),
    );
  });

  it("calls onOperationEnd with no error on a phase-2 succeeded operation", async () => {
    (mockContext.getStepData as Mock)
      .mockReturnValueOnce(null) // phase 1: no step data -> START checkpoint
      .mockReturnValue({
        Status: OperationStatus.SUCCEEDED,
        DistributedMapDetails: succeededDetails,
      });

    await makeHandler()([], processor, 2);

    expect(mockPlugin.onOperationStart).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationStart).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: false }),
    );
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.objectContaining({ isReplay: false }),
    );
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() }),
    );
  });

  it.each([
    ["FAILED", OperationStatus.FAILED],
    ["STOPPED", OperationStatus.STOPPED],
    ["TIMED_OUT", OperationStatus.TIMED_OUT],
  ])(
    "calls onOperationEnd with an error on an operation-level %s status",
    async (_label, status) => {
      (mockContext.getStepData as Mock).mockReturnValue({
        Status: status,
        DistributedMapDetails: { ...COUNTS },
      });

      // The operation resolves with the summary; only the plugin sees the error.
      const result = await makeHandler()([], processor, 2);
      expect(result.status).toBe(_label);

      expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
      expect(mockPlugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
      );
    },
  );

  it("ends a replayed CANCELLED operation with an error and does not start it", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: OperationStatus.CANCELLED,
      DistributedMapDetails: { ...COUNTS },
    });

    await makeHandler()([], processor, 2);

    expect(mockPlugin.onOperationStart).not.toHaveBeenCalled();
    expect(mockPlugin.onOperationEnd).toHaveBeenCalledTimes(1);
    const { error } = (mockPlugin.onOperationEnd as Mock).mock.calls[0][0] as {
      error: DistributedMapError;
    };
    expect(error.message).toBe("Map run ended CANCELLED");
  });

  it("passes the run Error's details to onOperationEnd", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: OperationStatus.FAILED,
      DistributedMapDetails: {
        ...COUNTS,
        Error: {
          ErrorType: "SourceReadError",
          ErrorMessage: "object not found",
          ErrorData: '{"key":"k"}',
        },
      },
    });

    await makeHandler()([], processor, 2);

    const { error } = (mockPlugin.onOperationEnd as Mock).mock.calls[0][0] as {
      error: DistributedMapError;
    };
    expect(error).toBeInstanceOf(DistributedMapError);
    expect(error.message).toBe("Map run ended FAILED: object not found");
    expect(error.cause?.name).toBe("SourceReadError");
    expect(error.errorData).toBe('{"key":"k"}');
  });

  it("does not throw when plugin hooks are undefined", async () => {
    (mockContext.getStepData as Mock).mockReturnValue({
      Status: OperationStatus.SUCCEEDED,
      DistributedMapDetails: succeededDetails,
    });

    const handler = createDistributedMapHandler(
      mockContext,
      mockCheckpoint,
      createStepId,
      undefined,
      vi.fn(),
      undefined,
      {},
    );

    const result = await handler([], processor, 2);
    expect(result.status).toBe("SUCCEEDED");
  });
});

describe("Distributed map run error in every plugin hook", () => {
  const lambdaContext = {
    awsRequestId: "request-1",
    getRemainingTimeInMillis: () => 300_000,
  } as unknown as Context;

  const failedRun = {
    Id: hashId("1"),
    Type: OperationType.DISTRIBUTED_MAP,
    SubType: OperationSubType.DISTRIBUTED_MAP,
    Name: "charge",
    Status: OperationStatus.FAILED,
    StartTimestamp: new Date().toISOString(),
    DistributedMapDetails: {
      ...COUNTS,
      Error: {
        ErrorType: "SourceReadError",
        ErrorMessage: "object not found",
        ErrorData: '{"key":"k"}',
      },
    },
  } as unknown as WireOperation;

  const executionOp = {
    Id: hashId("execution"),
    Type: OperationType.EXECUTION,
    Status: OperationStatus.STARTED,
    StartTimestamp: new Date().toISOString(),
    ExecutionDetails: { InputPayload: "{}" },
  } as unknown as WireOperation;

  // Runs a handler that calls distributedMap once, and returns the run error each hook saw.
  async function runWith(
    initialOperations: WireOperation[],
    checkpointOperations: WireOperation[],
  ): Promise<{
    end: Error | undefined;
    change: Error | undefined;
    invocationStart: Error | undefined;
  }> {
    const seen: {
      end?: Error;
      change?: Error;
      invocationStart?: Error;
    } = {};
    const plugin: DurableInstrumentationPlugin = {
      onInvocationStart: async (info) => {
        seen.invocationStart = info.operations[hashId("1")]?.error;
      },
      onOperationChange: async (info) => {
        const op: OperationInfo | undefined =
          info.updatedOperations[hashId("1")];
        if (op) seen.change = op.error;
      },
      onOperationEnd: async (info) => {
        seen.end = info.error;
      },
    };
    const client: DurableExecutionClient = {
      getExecutionState:
        async (): Promise<GetDurableExecutionStateResponse> => ({
          Operations: [],
          NextMarker: undefined,
        }),
      checkpoint: async (): Promise<CheckpointDurableExecutionResponse> =>
        ({
          CheckpointToken: "token-2",
          NewExecutionState: { Operations: checkpointOperations },
        }) as CheckpointDurableExecutionResponse,
    };
    const handler = withDurableExecution(
      async (_event: unknown, context) => {
        await context.distributedMap(
          "charge",
          [],
          DistributedMapProcessor.reportBatchOutcome("proc-fn"),
          2,
        );
        return "done";
      },
      { plugins: [{ createPlugin: () => plugin }] },
    );

    await handler(
      new DurableExecutionInvocationInputWithClient(
        {
          DurableExecutionArn:
            "arn:aws:lambda:us-east-1:123456789012:function:parent:$LATEST",
          CheckpointToken: "token-1",
          InitialExecutionState: {
            Operations: initialOperations,
            NextMarker: "",
          },
        },
        client,
      ),
      lambdaContext,
    );
    return {
      end: seen.end,
      change: seen.change,
      invocationStart: seen.invocationStart,
    };
  }

  const expectRunError = (seen: Error | undefined): void => {
    const error = seen as DistributedMapError;
    expect(error).toBeInstanceOf(DistributedMapError);
    expect(error.message).toBe("Map run ended FAILED: object not found");
    expect(error.cause?.name).toBe("SourceReadError");
    expect(error.errorData).toBe('{"key":"k"}');
  };

  it("gives onOperationChange the same error as onOperationEnd", async () => {
    const { change, end } = await runWith([executionOp], [failedRun]);

    expectRunError(end);
    expectRunError(change);
  });

  it("gives onInvocationStart the same error as onOperationEnd", async () => {
    const { invocationStart, end } = await runWith(
      [executionOp, failedRun],
      [],
    );

    expectRunError(end);
    expectRunError(invocationStart);
  });
});
