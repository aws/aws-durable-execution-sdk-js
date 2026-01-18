import {
  withStepSpan,
  withParallelBranchSpan,
  withParallelSpan,
  withRunInChildContextSpan,
  withWaitSpan,
  withMapSpan,
  withMapIterationSpan,
  withInvokeSpan,
  withCallbackSpan,
  withWaitForCallbackSpan,
  withWaitForConditionSpan,
  withExecutionSpan,
  getTracer,
} from "./otel-instrumentation";
import { trace, Span, SpanStatusCode } from "@opentelemetry/api";

// Mock the OpenTelemetry API
jest.mock("@opentelemetry/api", () => {
  const actualApi = jest.requireActual("@opentelemetry/api");
  return {
    ...actualApi,
    trace: {
      ...actualApi.trace,
      getTracer: jest.fn(),
      // getActiveSpan returns undefined (no active span) - tests the fallback path
      getActiveSpan: jest.fn().mockReturnValue(undefined),
    },
  };
});

describe("OpenTelemetry Instrumentation", () => {
  let mockSpan: jest.Mocked<Span>;
  let mockTracer: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mock span
    mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
      isRecording: jest.fn().mockReturnValue(true),
      spanContext: jest.fn().mockReturnValue({
        spanId: "test-span-id",
        traceId: "test-trace-id",
        traceFlags: 1,
      }),
    } as any;

    // Create a mock tracer that returns our mock span
    mockTracer = {
      startActiveSpan: jest.fn((name: string, fn: (span: Span) => any) => {
        return fn(mockSpan);
      }),
    };

    // Mock the trace.getTracer to return our mock tracer
    (trace.getTracer as jest.Mock).mockReturnValue(mockTracer);
  });

  describe("withStepSpan", () => {
    it("should create a span with step ID and name", async () => {
      const stepId = "step-123";
      const stepName = "test-step";
      const expectedResult = "test-result";

      const result = await withStepSpan(stepId, stepName, async () => {
        return expectedResult;
      });

      expect(result).toBe(expectedResult);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        stepName,
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.step.id",
        stepId,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.step.name",
        stepName,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "step",
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should use step ID as span name when step name is undefined", async () => {
      const stepId = "step-456";
      const expectedResult = "test-result";

      const result = await withStepSpan(stepId, undefined, async () => {
        return expectedResult;
      });

      expect(result).toBe(expectedResult);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        stepId,
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.step.id",
        stepId,
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        "durable.step.name",
        expect.anything(),
      );
    });

    it("should record error and set error status when function throws", async () => {
      const stepId = "step-789";
      const stepName = "error-step";
      const error = new Error("Test error");

      await expect(
        withStepSpan(stepId, stepName, async () => {
          throw error;
        }),
      ).rejects.toThrow(error);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: "Test error",
      });
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should handle non-Error exceptions", async () => {
      const stepId = "step-999";
      const stepName = "non-error-step";
      const errorMessage = "String error";

      await expect(
        withStepSpan(stepId, stepName, async () => {
          throw errorMessage;
        }),
      ).rejects.toBe(errorMessage);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      });
      expect(mockSpan.recordException).not.toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should always end the span even if function throws", async () => {
      const stepId = "step-end-test";
      const stepName = "end-test-step";

      await expect(
        withStepSpan(stepId, stepName, async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow();

      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe("withParallelBranchSpan", () => {
    it("should create a span with branch ID and name", async () => {
      const branchId = "parallel-branch-0";
      const branchName = "test-branch";
      const expectedResult = "test-result";

      const result = await withParallelBranchSpan(
        branchId,
        branchName,
        async () => {
          return expectedResult;
        },
      );

      expect(result).toBe(expectedResult);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        branchName,
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.parallel.branch.id",
        branchId,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.parallel.branch.name",
        branchName,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "parallel-branch",
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should use branch ID as span name when branch name is undefined", async () => {
      const branchId = "parallel-branch-1";
      const expectedResult = "test-result";

      const result = await withParallelBranchSpan(
        branchId,
        undefined,
        async () => {
          return expectedResult;
        },
      );

      expect(result).toBe(expectedResult);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        branchId,
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.parallel.branch.id",
        branchId,
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        "durable.parallel.branch.name",
        expect.anything(),
      );
    });

    it("should record error and set error status when function throws", async () => {
      const branchId = "parallel-branch-2";
      const branchName = "error-branch";
      const error = new Error("Test error");

      await expect(
        withParallelBranchSpan(branchId, branchName, async () => {
          throw error;
        }),
      ).rejects.toThrow(error);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: "Test error",
      });
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should handle non-Error exceptions", async () => {
      const branchId = "parallel-branch-3";
      const branchName = "non-error-branch";
      const errorMessage = "String error";

      await expect(
        withParallelBranchSpan(branchId, branchName, async () => {
          throw errorMessage;
        }),
      ).rejects.toBe(errorMessage);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      });
      expect(mockSpan.recordException).not.toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should always end the span even if function throws", async () => {
      const branchId = "parallel-branch-4";
      const branchName = "end-test-branch";

      await expect(
        withParallelBranchSpan(branchId, branchName, async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow();

      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe("withParallelSpan", () => {
    it("should create a span with parallel name", async () => {
      const parallelName = "test-parallel";
      const expectedResult = { totalCount: 2, all: ["result1", "result2"] };

      const result = await withParallelSpan(parallelName, async () => {
        return expectedResult;
      });

      expect(result).toBe(expectedResult);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        parallelName,
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.parallel.name",
        parallelName,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "parallel",
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should use default span name when parallel name is undefined", async () => {
      const expectedResult = { totalCount: 1, all: ["result"] };

      const result = await withParallelSpan(undefined, async () => {
        return expectedResult;
      });

      expect(result).toBe(expectedResult);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        "parallel",
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        "durable.parallel.name",
        expect.anything(),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "parallel",
      );
    });

    it("should record error and set error status when function throws", async () => {
      const parallelName = "error-parallel";
      const error = new Error("Test error");

      await expect(
        withParallelSpan(parallelName, async () => {
          throw error;
        }),
      ).rejects.toThrow(error);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: "Test error",
      });
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should handle non-Error exceptions", async () => {
      const parallelName = "non-error-parallel";
      const errorMessage = "String error";

      await expect(
        withParallelSpan(parallelName, async () => {
          throw errorMessage;
        }),
      ).rejects.toBe(errorMessage);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      });
      expect(mockSpan.recordException).not.toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should always end the span even if function throws", async () => {
      const parallelName = "end-test-parallel";

      await expect(
        withParallelSpan(parallelName, async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow();

      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe("withRunInChildContextSpan", () => {
    it("should create a span with entity ID and name", async () => {
      const entityId = "child-context-123";
      const name = "test-child-context";
      const expectedResult = "test-result";

      const result = await withRunInChildContextSpan(
        entityId,
        name,
        async () => {
          return expectedResult;
        },
      );

      expect(result).toBe(expectedResult);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        name,
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.child-context.id",
        entityId,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.child-context.name",
        name,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "run-in-child-context",
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should use entity ID as span name when name is undefined", async () => {
      const entityId = "child-context-456";
      const expectedResult = "test-result";

      const result = await withRunInChildContextSpan(
        entityId,
        undefined,
        async () => {
          return expectedResult;
        },
      );

      expect(result).toBe(expectedResult);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        entityId,
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.child-context.id",
        entityId,
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        "durable.child-context.name",
        expect.anything(),
      );
    });

    it("should record error and set error status when function throws", async () => {
      const entityId = "child-context-789";
      const name = "error-child-context";
      const error = new Error("Test error");

      await expect(
        withRunInChildContextSpan(entityId, name, async () => {
          throw error;
        }),
      ).rejects.toThrow(error);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: "Test error",
      });
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should handle non-Error exceptions", async () => {
      const entityId = "child-context-999";
      const name = "non-error-child-context";
      const errorMessage = "String error";

      await expect(
        withRunInChildContextSpan(entityId, name, async () => {
          throw errorMessage;
        }),
      ).rejects.toBe(errorMessage);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      });
      expect(mockSpan.recordException).not.toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should always end the span even if function throws", async () => {
      const entityId = "child-context-end-test";
      const name = "end-test-child-context";

      await expect(
        withRunInChildContextSpan(entityId, name, async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow();

      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe("withWaitSpan", () => {
    it("should create a span with wait ID and name using StartTimestamp", async () => {
      const stepId = "wait-123";
      const waitName = "test-wait";
      const waitDurationSeconds = 5;
      const expectedResult = "test-result";

      const startTimestamp = new Date("2024-01-01T00:00:00Z");
      const stepData = {
        Id: stepId,
        Status: "SUCCEEDED",
        StartTimestamp: startTimestamp,
        WaitDetails: {
          ScheduledEndTimestamp: new Date("2024-01-01T00:00:05Z"),
        },
      } as any;

      // Mock startSpan to return our mock span
      mockTracer.startSpan = jest.fn((name: string, options?: any) => {
        expect(options?.startTime).toBe(startTimestamp.getTime());
        return mockSpan;
      });

      const result = await withWaitSpan(
        stepId,
        waitName,
        stepData,
        waitDurationSeconds,
        async () => {
          return expectedResult;
        },
      );

      expect(result).toBe(expectedResult);
      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        "wait step",
        expect.objectContaining({
          startTime: startTimestamp.getTime(),
        }),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.wait.id",
        stepId,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.wait.name",
        waitName,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "wait",
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.wait.duration.seconds",
        waitDurationSeconds,
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should use fixed span name 'wait step' when wait name is undefined", async () => {
      const stepId = "wait-456";
      const waitDurationSeconds = 10;
      const expectedResult = "test-result";

      const startTimestamp = new Date("2024-01-01T00:00:00Z");
      const stepData = {
        Id: stepId,
        Status: "SUCCEEDED",
        StartTimestamp: startTimestamp,
      } as any;

      mockTracer.startSpan = jest.fn((name: string, options?: any) => {
        return mockSpan;
      });

      const result = await withWaitSpan(
        stepId,
        undefined,
        stepData,
        waitDurationSeconds,
        async () => {
          return expectedResult;
        },
      );

      expect(result).toBe(expectedResult);
      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        "wait step",
        expect.any(Object),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.wait.id",
        stepId,
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        "durable.wait.name",
        expect.anything(),
      );
    });

    it("should calculate start time from ScheduledEndTimestamp when StartTimestamp is missing", async () => {
      const stepId = "wait-789";
      const waitName = "calculated-wait";
      const waitDurationSeconds = 3;
      const expectedResult = "test-result";

      const scheduledEndTimestamp = new Date("2024-01-01T00:00:05Z");
      const stepData = {
        Id: stepId,
        Status: "SUCCEEDED",
        WaitDetails: {
          ScheduledEndTimestamp: scheduledEndTimestamp,
        },
      } as any;

      const expectedStartTime = new Date(
        scheduledEndTimestamp.getTime() - waitDurationSeconds * 1000,
      );

      mockTracer.startSpan = jest.fn((name: string, options?: any) => {
        expect(options?.startTime).toBe(expectedStartTime.getTime());
        return mockSpan;
      });

      const result = await withWaitSpan(
        stepId,
        waitName,
        stepData,
        waitDurationSeconds,
        async () => {
          return expectedResult;
        },
      );

      expect(result).toBe(expectedResult);
      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        "wait step",
        expect.objectContaining({
          startTime: expectedStartTime.getTime(),
        }),
      );
    });

    it("should use current time as fallback when no timing information is available", async () => {
      const stepId = "wait-fallback";
      const waitName = "fallback-wait";
      const waitDurationSeconds = 2;
      const expectedResult = "test-result";

      const stepData = undefined;
      const beforeCall = Date.now();

      mockTracer.startSpan = jest.fn((name: string, options?: any) => {
        const afterCall = Date.now();
        expect(options?.startTime).toBeGreaterThanOrEqual(beforeCall);
        expect(options?.startTime).toBeLessThanOrEqual(afterCall);
        return mockSpan;
      });

      const result = await withWaitSpan(
        stepId,
        waitName,
        stepData,
        waitDurationSeconds,
        async () => {
          return expectedResult;
        },
      );

      expect(result).toBe(expectedResult);
      expect(mockTracer.startSpan).toHaveBeenCalled();
    });

    it("should record error and set error status when function throws", async () => {
      const stepId = "wait-error";
      const waitName = "error-wait";
      const waitDurationSeconds = 1;
      const error = new Error("Test error");

      const startTimestamp = new Date("2024-01-01T00:00:00Z");
      const stepData = {
        Id: stepId,
        Status: "SUCCEEDED",
        StartTimestamp: startTimestamp,
      } as any;

      mockTracer.startSpan = jest.fn(() => mockSpan);

      await expect(
        withWaitSpan(
          stepId,
          waitName,
          stepData,
          waitDurationSeconds,
          async () => {
            throw error;
          },
        ),
      ).rejects.toThrow(error);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: "Test error",
      });
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should handle non-Error exceptions", async () => {
      const stepId = "wait-non-error";
      const waitName = "non-error-wait";
      const waitDurationSeconds = 1;
      const errorMessage = "String error";

      const startTimestamp = new Date("2024-01-01T00:00:00Z");
      const stepData = {
        Id: stepId,
        Status: "SUCCEEDED",
        StartTimestamp: startTimestamp,
      } as any;

      mockTracer.startSpan = jest.fn(() => mockSpan);

      await expect(
        withWaitSpan(
          stepId,
          waitName,
          stepData,
          waitDurationSeconds,
          async () => {
            throw errorMessage;
          },
        ),
      ).rejects.toBe(errorMessage);

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      });
      expect(mockSpan.recordException).not.toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should always end the span even if function throws", async () => {
      const stepId = "wait-end-test";
      const waitName = "end-test-wait";
      const waitDurationSeconds = 1;

      const startTimestamp = new Date("2024-01-01T00:00:00Z");
      const stepData = {
        Id: stepId,
        Status: "SUCCEEDED",
        StartTimestamp: startTimestamp,
      } as any;

      mockTracer.startSpan = jest.fn(() => mockSpan);

      await expect(
        withWaitSpan(
          stepId,
          waitName,
          stepData,
          waitDurationSeconds,
          async () => {
            throw new Error("Test error");
          },
        ),
      ).rejects.toThrow();

      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should end span with current time", async () => {
      const stepId = "wait-timing";
      const waitName = "timing-wait";
      const waitDurationSeconds = 5;
      const expectedResult = "test-result";

      const startTimestamp = new Date("2024-01-01T00:00:00Z");
      const stepData = {
        Id: stepId,
        Status: "SUCCEEDED",
        StartTimestamp: startTimestamp,
      } as any;

      mockTracer.startSpan = jest.fn(() => mockSpan);

      const beforeEnd = Date.now();
      const result = await withWaitSpan(
        stepId,
        waitName,
        stepData,
        waitDurationSeconds,
        async () => {
          return expectedResult;
        },
      );
      const afterEnd = Date.now();

      expect(result).toBe(expectedResult);
      expect(mockSpan.end).toHaveBeenCalled();
      const endCall = (mockSpan.end as jest.Mock).mock.calls[0][0];
      expect(endCall).toBeGreaterThanOrEqual(beforeEnd);
      expect(endCall).toBeLessThanOrEqual(afterEnd);
    });
  });

  describe("withMapSpan", () => {
    it("should create a span with map name", async () => {
      const mapName = "map-users";
      const expectedResult = { totalCount: 2 };

      const result = await withMapSpan(mapName, async () => expectedResult);

      expect(result).toBe(expectedResult);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        mapName,
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "map",
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe("withMapIterationSpan", () => {
    it("should set map iteration attributes", async () => {
      const itemId = "map-item-1";
      const itemName = "user-1";
      const itemIndex = 1;

      const result = await withMapIterationSpan(
        itemId,
        itemName,
        itemIndex,
        async () => "ok",
      );

      expect(result).toBe("ok");
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.map.item.index",
        itemIndex,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.map.item.id",
        itemId,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.map.item.name",
        itemName,
      );
    });
  });

  describe("withInvokeSpan", () => {
    it("should set invoke attributes", async () => {
      const stepId = "invoke-1";
      const name = "invoke-user";
      const functionId = "arn:aws:lambda:us-east-1:123:function:handler";

      const result = await withInvokeSpan(
        stepId,
        name,
        functionId,
        async () => "done",
      );

      expect(result).toBe("done");
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.invoke.function_id",
        functionId,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "invoke",
      );
    });
  });

  describe("withCallbackSpan", () => {
    it("should set callback attributes", async () => {
      const stepId = "callback-1";
      const name = "callback";

      const result = await withCallbackSpan(stepId, name, async () => "ok");

      expect(result).toBe("ok");
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "callback",
      );
    });
  });

  describe("withWaitForCallbackSpan", () => {
    it("should set waitForCallback attributes", async () => {
      const stepId = "wait-callback-1";
      const name = "wait-for-callback";

      const result = await withWaitForCallbackSpan(
        stepId,
        name,
        async () => "ok",
      );

      expect(result).toBe("ok");
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "wait-for-callback",
      );
    });
  });

  describe("withWaitForConditionSpan", () => {
    it("should set waitForCondition attributes", async () => {
      const stepId = "wait-condition-1";
      const name = "wait-for-condition";

      const result = await withWaitForConditionSpan(
        stepId,
        name,
        async () => "ok",
      );

      expect(result).toBe("ok");
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "wait-for-condition",
      );
    });
  });

  describe("withExecutionSpan", () => {
    it("should set execution attributes", async () => {
      const executionName = "durable-execution";

      const result = await withExecutionSpan(executionName, async () => "ok", {
        executionArn: "arn:aws:states:us-east-1:123:execution:exec",
        attributes: {
          "durable.execution.request_id": "req-123",
        },
      });

      expect(result).toBe("ok");
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.operation.type",
        "execution",
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.execution.arn",
        "arn:aws:states:us-east-1:123:execution:exec",
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        "durable.execution.request_id",
        "req-123",
      );
    });
  });

  describe("getTracer", () => {
    it("should get tracer with correct name", () => {
      getTracer();

      expect(trace.getTracer).toHaveBeenCalledWith(
        "@aws/durable-execution-sdk-js",
      );
    });
  });
});
