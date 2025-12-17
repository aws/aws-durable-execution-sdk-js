import {
  withStepSpan,
  withParallelBranchSpan,
  withParallelSpan,
  getTracer,
} from "./otel-instrumentation";
import { trace, Span, SpanStatusCode } from "@opentelemetry/api";

// Mock the OpenTelemetry API
jest.mock("@opentelemetry/api", () => {
  const actualApi = jest.requireActual("@opentelemetry/api");
  return {
    ...actualApi,
    trace: {
      getTracer: jest.fn(),
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

  describe("getTracer", () => {
    it("should get tracer with correct name", () => {
      getTracer();

      expect(trace.getTracer).toHaveBeenCalledWith(
        "@aws/durable-execution-sdk-js",
      );
    });
  });
});
