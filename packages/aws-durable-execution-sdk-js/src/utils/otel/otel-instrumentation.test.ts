import { withStepSpan, getTracer } from "./otel-instrumentation";
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

  describe("getTracer", () => {
    it("should get tracer with correct name", () => {
      getTracer();

      expect(trace.getTracer).toHaveBeenCalledWith(
        "@aws/durable-execution-sdk-js",
      );
    });
  });
});
