import { createWaitForCallbackHandler } from "./wait-for-callback-handler";
import { ExecutionContext, WaitForCallbackConfig } from "../../types";
import { CheckpointFunction } from "../../testing/mock-checkpoint";
import * as serdesErrors from "../../errors/serdes-errors/serdes-errors";
import * as callbackHandler from "../callback-handler/callback";

/**
 * Builds a mock child context that mirrors the internal methods the
 * waitForCallback handler actually calls: `_createCallbackWithPluginOperationName`
 * and `_stepWithPluginOperationName` (the internal variants that carry the
 * plugin-only operation name). Optional hooks let a test capture the
 * plugin-operation-name / config arguments.
 */
function makeMockChildCtx(opts: {
  callbackResult: unknown;
  callbackId: string;
  onCreateCallback?: (
    pluginOperationName: string | undefined,
    config: unknown,
  ) => void;
  onStep?: (
    pluginOperationName: string | undefined,
    config: unknown,
  ) => void | Promise<void>;
}) {
  const mockTelemetry = {
    logger: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  };

  return {
    _createCallbackWithPluginOperationName: jest
      .fn()
      .mockImplementation((pluginOperationName: unknown, config: unknown) => {
        opts.onCreateCallback?.(
          pluginOperationName as string | undefined,
          config,
        );
        return Promise.resolve([
          Promise.resolve(opts.callbackResult),
          opts.callbackId,
        ]);
      }),
    _stepWithPluginOperationName: jest
      .fn()
      .mockImplementation(
        async (pluginOperationName: unknown, fn: unknown, config?: unknown) => {
          await opts.onStep?.(
            pluginOperationName as string | undefined,
            config,
          );
          if (typeof fn === "function") {
            return await fn(mockTelemetry);
          }
          return undefined;
        },
      ),
  };
}

describe("waitForCallback handler", () => {
  let mockExecutionContext: ExecutionContext;
  let mockCheckpoint: CheckpointFunction;
  let mockRunInChildContext: jest.Mock;
  let mockGetNextStepId: jest.Mock;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    mockExecutionContext = {
      _stepData: {},
      terminationManager: {
        terminate: jest.fn(),
      },
      durableExecutionArn: "test-arn",
    } as any;

    mockCheckpoint = jest.fn() as unknown as CheckpointFunction;
    (mockCheckpoint as any).force = jest.fn().mockResolvedValue(undefined);
    mockRunInChildContext = jest.fn();
    mockGetNextStepId = jest.fn().mockReturnValue("test-step-id");

    // Mock the external functions
    jest
      .spyOn(serdesErrors, "safeDeserialize")
      .mockImplementation(async (serdes, data) => data);
    jest.spyOn(callbackHandler, "createPassThroughSerdes").mockReturnValue({
      serialize: jest.fn().mockResolvedValue("serialized"),
      deserialize: jest.fn().mockResolvedValue("deserialized"),
    });
  });

  it("should handle waitForCallback with submitter function", async () => {
    const submitter = jest.fn().mockResolvedValue(undefined);
    const expectedResult = "callback result";

    // Mock runInChildContext to handle the unified signature (name, function)
    mockRunInChildContext.mockImplementation(async (name: any, fn: any) => {
      expect(name).toBeUndefined(); // When no name provided, should be undefined
      expect(typeof fn).toBe("function");

      const mockChildCtx = makeMockChildCtx({
        callbackResult: expectedResult,
        callbackId: "callback-123",
      });

      return await fn(mockChildCtx);
    });

    const handler = createWaitForCallbackHandler(
      mockExecutionContext,
      mockGetNextStepId,
      mockRunInChildContext,
    );

    const result = await handler(submitter);

    expect(result).toBe(expectedResult);
    // With unified signature, runInChildContext is always called with (name, function)
    expect(mockRunInChildContext).toHaveBeenCalledWith(
      undefined,
      expect.any(Function),
      expect.objectContaining({ subType: "WaitForCallback" }),
    );
    expect(submitter).toHaveBeenCalledWith(
      "callback-123",
      expect.objectContaining({
        logger: expect.any(Object),
      }),
    );
  });

  it("should handle waitForCallback with name and submitter", async () => {
    const submitter = jest.fn().mockResolvedValue(undefined);
    const expectedResult = "named callback result";
    const callbackName = "myCallback";

    let callbackPluginName: string | undefined;
    let stepPluginName: string | undefined;

    mockRunInChildContext.mockImplementation(async (name: string, fn: any) => {
      const mockChildCtx = makeMockChildCtx({
        callbackResult: expectedResult,
        callbackId: "callback-456",
        onCreateCallback: (pluginOperationName) => {
          callbackPluginName = pluginOperationName;
        },
        onStep: (pluginOperationName) => {
          stepPluginName = pluginOperationName;
        },
      });

      return await fn(mockChildCtx);
    });

    const handler = createWaitForCallbackHandler(
      mockExecutionContext,
      mockGetNextStepId,
      mockRunInChildContext,
    );

    const result = await handler(callbackName, submitter);

    expect(result).toBe(expectedResult);
    expect(mockRunInChildContext).toHaveBeenCalledWith(
      callbackName,
      expect.any(Function),
      expect.objectContaining({ subType: "WaitForCallback" }),
    );
    // The named waitForCallback forwards derived plugin operation names to the
    // inner CALLBACK and submitter STEP.
    expect(callbackPluginName).toBe("myCallback-callback");
    expect(stepPluginName).toBe("myCallback-submitter");
    expect(submitter).toHaveBeenCalledWith(
      "callback-456",
      expect.objectContaining({
        logger: expect.any(Object),
      }),
    );
  });

  it("should throw error when called without submitter", async () => {
    const handler = createWaitForCallbackHandler(
      mockExecutionContext,
      mockGetNextStepId,
      mockRunInChildContext,
    );

    // Should throw error when no parameters are provided
    // Using type assertion to test runtime behavior despite TypeScript error
    await expect((handler as any)()).rejects.toThrow(
      "waitForCallback requires a submitter function",
    );
  });

  it("should throw error when name is provided but submitter is not a function", async () => {
    const handler = createWaitForCallbackHandler(
      mockExecutionContext,
      mockGetNextStepId,
      mockRunInChildContext,
    );

    const config = { timeout: { minutes: 5 } };

    // Should throw error when name is provided but second parameter is not a function
    await expect(handler("test-name", config as any)).rejects.toThrow(
      "waitForCallback requires a submitter function when name is provided",
    );
  });

  it("should call runInChildContext with unified signature when no name is provided", async () => {
    const submitter = jest.fn().mockResolvedValue(undefined);
    const expectedResult = "no name result";

    let callbackPluginName: string | undefined = "unset";
    let stepPluginName: string | undefined = "unset";

    mockRunInChildContext.mockImplementation(async (name: any, fn: any) => {
      // With unified signature, name should be undefined when no name provided
      expect(name).toBeUndefined();
      expect(typeof fn).toBe("function");

      const mockChildCtx = makeMockChildCtx({
        callbackResult: expectedResult,
        callbackId: "callback-no-name",
        onCreateCallback: (pluginOperationName) => {
          callbackPluginName = pluginOperationName;
        },
        onStep: (pluginOperationName) => {
          stepPluginName = pluginOperationName;
        },
      });

      return await fn(mockChildCtx);
    });

    const handler = createWaitForCallbackHandler(
      mockExecutionContext,
      mockGetNextStepId,
      mockRunInChildContext,
    );

    const result = await handler(submitter);

    expect(result).toBe(expectedResult);
    expect(mockRunInChildContext).toHaveBeenCalledWith(
      undefined,
      expect.any(Function),
      expect.objectContaining({ subType: "WaitForCallback" }),
    );
    // With no name, no derived plugin operation name is forwarded.
    expect(callbackPluginName).toBeUndefined();
    expect(stepPluginName).toBeUndefined();
    expect(submitter).toHaveBeenCalledWith(
      "callback-no-name",
      expect.objectContaining({
        logger: expect.any(Object),
      }),
    );
  });

  it("should accept undefined as name parameter", async () => {
    const submitter = jest.fn().mockResolvedValue(undefined);
    const expectedResult = "undefined name result";

    mockRunInChildContext.mockImplementation(async (name: any, fn: any) => {
      expect(name).toBeUndefined();
      expect(typeof fn).toBe("function");

      const mockChildCtx = makeMockChildCtx({
        callbackResult: expectedResult,
        callbackId: "callback-undefined",
      });

      return await fn(mockChildCtx);
    });

    const handler = createWaitForCallbackHandler(
      mockExecutionContext,
      mockGetNextStepId,
      mockRunInChildContext,
    );

    const result = await handler(undefined, submitter);

    expect(result).toBe(expectedResult);
    expect(mockRunInChildContext).toHaveBeenCalledWith(
      undefined,
      expect.any(Function),
      expect.objectContaining({ subType: "WaitForCallback" }),
    );
    expect(submitter).toHaveBeenCalledWith(
      "callback-undefined",
      expect.objectContaining({
        logger: expect.any(Object),
      }),
    );
  });

  it("should throw error when invalid parameter type is provided", async () => {
    const handler = createWaitForCallbackHandler(
      mockExecutionContext,
      mockGetNextStepId,
      mockRunInChildContext,
    );

    // Test with an invalid parameter type (number) to cover the else branch
    // Using type assertion to bypass TypeScript checking
    await expect((handler as any)(123)).rejects.toThrow(
      "waitForCallback requires a submitter function",
    );
  });

  it("should pass config to createCallback when submitter and config are provided", async () => {
    const config: WaitForCallbackConfig<string> = {
      timeout: { minutes: 5 },
      heartbeatTimeout: { seconds: 30 },
    };
    const submitter = jest.fn().mockResolvedValue(undefined);
    const expectedResult = "config result";

    let capturedConfig: any;
    mockRunInChildContext.mockImplementation(
      async (fnOrName: any, maybeFn?: any) => {
        // When no name is provided, first parameter is the function
        const fn = maybeFn || fnOrName;

        const mockChildCtx = makeMockChildCtx({
          callbackResult: expectedResult,
          callbackId: "callback-config",
          onCreateCallback: (_pluginOperationName, cfg) => {
            capturedConfig = cfg;
          },
        });

        return await fn(mockChildCtx);
      },
    );

    const handler = createWaitForCallbackHandler(
      mockExecutionContext,
      mockGetNextStepId,
      mockRunInChildContext,
    );

    // Pass submitter as first parameter and config as second parameter
    const result = await handler(submitter, config);

    expect(result).toBe(expectedResult);
    expect(capturedConfig).toMatchObject({
      timeout: { minutes: 5 },
      heartbeatTimeout: { seconds: 30 },
    });
    // serdes is not injected when no defaultCallbackDeserializer is configured
    expect(capturedConfig).not.toHaveProperty("serdes");
    expect(submitter).toHaveBeenCalledWith(
      "callback-config",
      expect.objectContaining({
        logger: expect.any(Object),
      }),
    );
  });

  it("should pass retryStrategy to submitter step", async () => {
    const submitter = jest.fn().mockRejectedValue(new Error("Submitter error"));
    const retryStrategy = jest.fn().mockReturnValue({
      shouldRetry: false,
    });

    mockRunInChildContext.mockImplementation(async (name: any, fn: any) => {
      const mockChildCtx = makeMockChildCtx({
        callbackResult: "result",
        callbackId: "callback-retry",
        onStep: (_pluginOperationName, config) => {
          // The submitter step receives the retryStrategy via its config.
          if ((config as any)?.retryStrategy) {
            expect((config as any).retryStrategy).toBe(retryStrategy);
          }
        },
      });

      return await fn(mockChildCtx);
    });

    const handler = createWaitForCallbackHandler(
      mockExecutionContext,
      mockGetNextStepId,
      mockRunInChildContext,
    );

    await expect(handler(submitter, { retryStrategy })).rejects.toThrow(
      "Submitter error",
    );
  });

  describe("serdes parameter usage", () => {
    const customSerdes = {
      serialize: jest.fn().mockResolvedValue("serialized-data"),
      deserialize: jest.fn().mockResolvedValue({ data: "deserialized" }),
    };

    it.each([
      {
        name: "with serdes",
        config: { serdes: customSerdes, timeout: { minutes: 5 } },
        expectedSerdes: customSerdes,
      },
      {
        name: "without serdes",
        config: { heartbeatTimeout: { seconds: 30 } },
        expectedSerdes: undefined,
      },
    ])(
      "should not pass serdes to runInChildContext or createCallback, but use for deserialization ($name)",
      async ({ name, config, expectedSerdes }) => {
        const submitter = jest.fn().mockResolvedValue(undefined);
        const rawResult = `raw-result-${name}`;
        const deserializedResult = `deserialized-${name}`;

        let capturedRunInChildContextOptions: any;
        let capturedCreateCallbackConfig: any;

        // Mock safeDeserialize to return our expected result
        const mockSafeDeserialize = jest.spyOn(serdesErrors, "safeDeserialize");
        mockSafeDeserialize.mockResolvedValue(deserializedResult);

        // Re-mock createPassThroughSerdes for this test case
        jest.spyOn(callbackHandler, "createPassThroughSerdes").mockReturnValue({
          serialize: jest.fn().mockResolvedValue("serialized"),
          deserialize: jest.fn().mockResolvedValue("deserialized"),
        });

        mockRunInChildContext.mockImplementation(
          async (name: any, fn: any, options: any) => {
            capturedRunInChildContextOptions = options;

            const mockChildCtx = makeMockChildCtx({
              callbackResult: rawResult,
              callbackId: "callback-id",
              onCreateCallback: (_pluginOperationName, cfg) => {
                capturedCreateCallbackConfig = cfg;
              },
            });

            return await fn(mockChildCtx);
          },
        );

        const handler = createWaitForCallbackHandler(
          mockExecutionContext,
          mockGetNextStepId,
          mockRunInChildContext,
        );

        const result = await handler(submitter, config);

        expect(result).toBe(deserializedResult);

        // Verify serdes is NOT passed to runInChildContext (only subType and errorMapper)
        // when no defaultCallbackDeserializer is configured
        expect(capturedRunInChildContextOptions).toMatchObject({
          subType: "WaitForCallback",
        });
        expect(capturedRunInChildContextOptions).toHaveProperty("errorMapper");
        expect(capturedRunInChildContextOptions).not.toHaveProperty("serdes");

        // Verify passthrough serdes is NOT passed to createCallback when no
        // defaultCallbackDeserializer is configured
        expect(capturedCreateCallbackConfig).toMatchObject({
          timeout: config.timeout || undefined,
          heartbeatTimeout: config.heartbeatTimeout || undefined,
        });
        expect(capturedCreateCallbackConfig).not.toHaveProperty("serdes");

        // Verify safeDeserialize was called with correct parameters
        if (expectedSerdes) {
          // When custom serdes is provided, it should be used directly
          expect(mockSafeDeserialize).toHaveBeenCalledWith(
            expectedSerdes,
            rawResult,
            "test-step-id",
            undefined,
            mockExecutionContext.terminationManager,
            mockExecutionContext.durableExecutionArn,
          );
          // createPassThroughSerdes should NOT be called for outer deserialization when custom serdes is provided
          // (it IS called for inner createCallback and runInChildContext, but not for phase 2)
        } else {
          // When no serdes is provided, createPassThroughSerdes should be called
          const mockPassThroughSerdes = (
            callbackHandler.createPassThroughSerdes as jest.Mock
          ).mock.results[0].value;
          expect(callbackHandler.createPassThroughSerdes).toHaveBeenCalled();
          expect(mockSafeDeserialize).toHaveBeenCalledWith(
            mockPassThroughSerdes,
            rawResult,
            "test-step-id",
            undefined,
            mockExecutionContext.terminationManager,
            mockExecutionContext.durableExecutionArn,
          );
        }
      },
    );
  });
});
