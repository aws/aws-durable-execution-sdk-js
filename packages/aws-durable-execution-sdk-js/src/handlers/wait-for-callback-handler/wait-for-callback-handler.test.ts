import { createWaitForCallbackHandler } from "./wait-for-callback-handler";
import { ExecutionContext, WaitForCallbackConfig } from "../../types";
import { CheckpointFunction } from "../../testing/mock-checkpoint";
import * as serdesErrors from "../../errors/serdes-errors/serdes-errors";
import * as callbackHandler from "../callback-handler/callback";

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

      // Create a mock child context
      const mockChildCtx = {
        createCallback: jest
          .fn()
          .mockResolvedValue([Promise.resolve(expectedResult), "callback-123"]),
        step: jest
          .fn()
          .mockImplementation(async (stepNameOrFn: any, maybeFn?: any) => {
            // Create mock telemetry object
            const mockTelemetry = {
              logger: {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
              },
            };

            // Handle both overloads of step function
            if (typeof stepNameOrFn === "function") {
              return await stepNameOrFn(mockTelemetry);
            } else if (typeof maybeFn === "function") {
              return await maybeFn(mockTelemetry);
            }
            return undefined;
          }),
      };

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
      { subType: "WaitForCallback" },
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

    mockRunInChildContext.mockImplementation(async (name: string, fn: any) => {
      const mockChildCtx = {
        createCallback: jest
          .fn()
          .mockResolvedValue([Promise.resolve(expectedResult), "callback-456"]),
        step: jest
          .fn()
          .mockImplementation(async (stepNameOrFn: any, maybeFn?: any) => {
            // Create mock telemetry object
            const mockTelemetry = {
              logger: {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
              },
            };

            // Handle both overloads of step function
            if (typeof stepNameOrFn === "function") {
              return await stepNameOrFn(mockTelemetry);
            } else if (typeof maybeFn === "function") {
              return await maybeFn(mockTelemetry);
            }
            return undefined;
          }),
      };

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
      { subType: "WaitForCallback" },
    );
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

    mockRunInChildContext.mockImplementation(async (name: any, fn: any) => {
      // With unified signature, name should be undefined when no name provided
      expect(name).toBeUndefined();
      expect(typeof fn).toBe("function");

      const mockChildCtx = {
        createCallback: jest
          .fn()
          .mockResolvedValue([
            Promise.resolve(expectedResult),
            "callback-no-name",
          ]),
        step: jest
          .fn()
          .mockImplementation(async (stepNameOrFn: any, maybeFn?: any) => {
            // Create mock telemetry object
            const mockTelemetry = {
              logger: {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
              },
            };

            // Handle both overloads of step function
            if (typeof stepNameOrFn === "function") {
              return await stepNameOrFn(mockTelemetry);
            } else if (typeof maybeFn === "function") {
              return await maybeFn(mockTelemetry);
            }
            return undefined;
          }),
      };

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
      { subType: "WaitForCallback" },
    );
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

      const mockChildCtx = {
        createCallback: jest
          .fn()
          .mockResolvedValue([
            Promise.resolve(expectedResult),
            "callback-undefined",
          ]),
        step: jest
          .fn()
          .mockImplementation(async (stepNameOrFn: any, maybeFn?: any) => {
            // Create mock telemetry object
            const mockTelemetry = {
              logger: {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
              },
            };

            if (typeof stepNameOrFn === "function") {
              return await stepNameOrFn(mockTelemetry);
            } else if (typeof maybeFn === "function") {
              return await maybeFn(mockTelemetry);
            }
            return undefined;
          }),
      };

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
      { subType: "WaitForCallback" },
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

        const mockChildCtx = {
          createCallback: jest.fn().mockImplementation((cfg) => {
            capturedConfig = cfg;
            return Promise.resolve([
              Promise.resolve(expectedResult),
              "callback-config",
            ]);
          }),
          step: jest
            .fn()
            .mockImplementation(async (stepNameOrFn: any, maybeFn?: any) => {
              // Create mock telemetry object
              const mockTelemetry = {
                logger: {
                  log: jest.fn(),
                  error: jest.fn(),
                  warn: jest.fn(),
                  info: jest.fn(),
                  debug: jest.fn(),
                },
              };

              // Handle both overloads of step function
              if (typeof stepNameOrFn === "function") {
                return await stepNameOrFn(mockTelemetry);
              } else if (typeof maybeFn === "function") {
                return await maybeFn(mockTelemetry);
              }
              return undefined;
            }),
        };

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
    expect(capturedConfig).toEqual({
      timeout: { minutes: 5 },
      heartbeatTimeout: { seconds: 30 },
      serdes: undefined,
    });
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
      const mockChildCtx = {
        createCallback: jest
          .fn()
          .mockResolvedValue([Promise.resolve("result"), "callback-retry"]),
        step: jest
          .fn()
          .mockImplementation(async (fnOrConfig: any, maybeConfig?: any) => {
            const mockTelemetry = {
              logger: {
                log: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                info: jest.fn(),
                debug: jest.fn(),
              },
            };

            // Check if retryStrategy was passed
            const config =
              typeof fnOrConfig === "function" ? maybeConfig : fnOrConfig;
            if (config?.retryStrategy) {
              expect(config.retryStrategy).toBe(retryStrategy);
            }

            // Execute the function
            const fn =
              typeof fnOrConfig === "function" ? fnOrConfig : maybeConfig;
            if (fn) {
              await fn(mockTelemetry);
            }
          }),
      };

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

            const mockChildCtx = {
              createCallback: jest.fn().mockImplementation((cfg) => {
                capturedCreateCallbackConfig = cfg;
                return Promise.resolve([
                  Promise.resolve(rawResult),
                  "callback-id",
                ]);
              }),
              step: jest
                .fn()
                .mockImplementation(
                  async (stepNameOrFn: any, maybeFn?: any) => {
                    const mockTelemetry = {
                      logger: {
                        log: jest.fn(),
                        error: jest.fn(),
                        warn: jest.fn(),
                        info: jest.fn(),
                        debug: jest.fn(),
                      },
                    };

                    if (typeof stepNameOrFn === "function") {
                      return await stepNameOrFn(mockTelemetry);
                    } else if (typeof maybeFn === "function") {
                      return await maybeFn(mockTelemetry);
                    }
                    return undefined;
                  },
                ),
            };

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

        // Verify serdes is NOT passed to runInChildContext (only subType)
        expect(capturedRunInChildContextOptions).toEqual({
          subType: "WaitForCallback",
        });

        // Verify serdes is NOT passed to createCallback (only timeout/heartbeatTimeout)
        expect(capturedCreateCallbackConfig).toEqual({
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
          // createPassThroughSerdes should NOT be called when custom serdes is provided
          expect(
            callbackHandler.createPassThroughSerdes,
          ).not.toHaveBeenCalled();
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
