import { createWaitForCallbackHandler } from "./wait-for-callback-handler";
import { ExecutionContext, WaitForCallbackConfig } from "../../types";
import { Context } from "aws-lambda";
import { createCheckpoint } from "../../utils/checkpoint/checkpoint";

describe("waitForCallback handler", () => {
  let mockExecutionContext: ExecutionContext;
  let mockParentContext: Context;
  let mockCheckpoint: ReturnType<typeof createCheckpoint>;
  let stepIdCounter: number;
  let mockRunInChildContext: jest.Mock;

  const createMockLogger = () => ({
    log: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  });
  const createMockEnrichedLogger = () => createMockLogger();

  beforeEach(() => {
    stepIdCounter = 0;

    mockExecutionContext = {
      _stepData: {},
      terminationManager: {
        terminate: jest.fn(),
      },
    } as any;

    mockParentContext = {} as Context;
    mockCheckpoint = jest.fn() as any;
    mockCheckpoint.force = jest.fn().mockResolvedValue(undefined);
    mockRunInChildContext = jest.fn();

    const createStepId = () => {
      stepIdCounter++;
      return `${stepIdCounter}`;
    };
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
      mockRunInChildContext,
    );

    const config = { timeout: 300 };

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
      mockRunInChildContext,
    );

    // Test with an invalid parameter type (number) to cover the else branch
    // Using type assertion to bypass TypeScript checking
    await expect((handler as any)(123)).rejects.toThrow(
      "waitForCallback requires a submitter function",
    );
  });

  it("should pass config to createCallback when submitter and config are provided", async () => {
    const config: WaitForCallbackConfig = {
      timeout: 300,
      heartbeatTimeout: 30,
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
      mockRunInChildContext,
    );

    // Pass submitter as first parameter and config as second parameter
    const result = await handler(submitter, config);

    expect(result).toBe(expectedResult);
    expect(capturedConfig).toEqual({
      timeout: 300,
      heartbeatTimeout: 30,
      serdes: undefined,
    });
    expect(submitter).toHaveBeenCalledWith(
      "callback-config",
      expect.objectContaining({
        logger: expect.any(Object),
      }),
    );
  });
});
