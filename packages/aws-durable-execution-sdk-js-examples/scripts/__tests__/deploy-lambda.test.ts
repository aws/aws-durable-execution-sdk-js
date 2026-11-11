import { vi, type Mock, type MockInstance } from "vitest";
import {
  LambdaClient,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  PublishVersionCommand,
  PutFunctionScalingConfigCommand,
  PutRuntimeManagementConfigCommand,
  DeleteFunctionCommand,
  LastUpdateStatusReasonCode,
  ResourceNotFoundException,
  ResourceConflictException,
} from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutRetentionPolicyCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { getEventListeners } from "node:events";
import { main } from "../deploy-lambda";

let mockUseCapacityProvider = true;

vi.mock("@aws-sdk/client-lambda", async () => ({
  ...(await vi.importActual("@aws-sdk/client-lambda")),
  LambdaClient: vi.fn(),
}));
vi.mock("@aws-sdk/client-cloudwatch-logs", async () => ({
  ...(await vi.importActual("@aws-sdk/client-cloudwatch-logs")),
  CloudWatchLogsClient: vi.fn(),
}));
vi.mock("argparse", () => ({
  // biome-ignore lint/complexity/useArrowFunction: the code calls this mock with `new`, and Vitest cannot construct an arrow function.
  ArgumentParser: vi.fn(function () {
    return {
      add_argument: vi.fn(),
      parse_args: () => ({
        example: "step-basic",
        function_name: "deploy-regression",
        runtime: "24.x",
        use_capacity_provider: mockUseCapacityProvider,
      }),
    };
  }),
}));
vi.mock("fs", async () => ({
  ...(await vi.importActual("fs")),
  existsSync: () => true,
  readFileSync: () => Buffer.from("mock deployment archive"),
}));
vi.mock(
  "@aws/durable-execution-sdk-js-examples/catalog",
  () => ({
    __esModule: true,
    default: [
      {
        name: "Basic step",
        handler: "step-basic.handler",
        description: "Deployment regression fixture",
        durableConfig: { ExecutionTimeout: 60, RetentionPeriodInDays: 1 },
        capacityProviderConfig: {},
      },
    ],
  }),
  { virtual: true },
);

const configuration = {
  State: "Active",
  LastUpdateStatus: "Successful",
  DurableConfig: { ExecutionTimeout: 60, RetentionPeriodInDays: 1 },
  CapacityProviderConfig: {},
};
const throttle = () =>
  Object.assign(new Error("Rate exceeded"), {
    name: "TooManyRequestsException",
    $metadata: { httpStatusCode: 429 },
  });
const conflict = () =>
  new ResourceConflictException({
    message: "Function already exists",
    $metadata: {},
  });

// Exercise the real deployment orchestration; only AWS, CLI and filesystem I/O
// are replaced. No credentials or Lambda resources are used by these tests.
describe("deployment retries", () => {
  let send: Mock;
  let logSend: Mock;
  let exit: MockInstance;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockUseCapacityProvider = true;
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");
    vi.stubEnv("AWS_REGION", "us-west-2");
    vi.stubEnv(
      "LAMBDA_EXECUTION_ROLE_ARN",
      "arn:aws:iam::123456789012:role/test",
    );
    vi.stubEnv(
      "CAPACITY_PROVIDER_ARN",
      "arn:aws:lambda:us-west-2:123456789012:capacity-provider:test",
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Deployment exited with failure");
    });
    send = vi.fn(async (command) => {
      if (command instanceof GetFunctionCommand) {
        throw new ResourceNotFoundException({
          message: "Not found",
          $metadata: {},
        });
      }
      if (command instanceof GetFunctionConfigurationCommand)
        return configuration;
      return {};
    });
    // biome-ignore lint/complexity/useArrowFunction: the code calls this mock with `new`, and Vitest cannot construct an arrow function.
    (LambdaClient as unknown as Mock).mockImplementation(function () {
      return { send };
    });
    logSend = vi.fn().mockResolvedValue({});
    // biome-ignore lint/complexity/useArrowFunction: the code calls this mock with `new`, and Vitest cannot construct an arrow function.
    (CloudWatchLogsClient as unknown as Mock).mockImplementation(function () {
      return { send: logSend };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function deploy() {
    const result = main().then(
      () => undefined,
      (error: Error) => error,
    );
    await vi.runAllTimersAsync();
    expect(await result).toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  }

  function commands<T>(type: new (input: never) => T): T[] {
    return send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof type);
  }

  test.each([false, true])(
    "retries throttling before creating or updating the function (exists=%s)",
    async (exists) => {
      const normal = send.getMockImplementation()!;
      let probes = 0;
      send.mockImplementation(async (command) => {
        if (command instanceof GetFunctionCommand) {
          if (++probes <= 2) throw throttle();
          if (exists) return {};
        }
        return normal(command);
      });
      await deploy();
      expect(commands(GetFunctionCommand)).toHaveLength(3);
      expect(commands(CreateFunctionCommand)).toHaveLength(exists ? 0 : 1);
      expect(commands(UpdateFunctionCodeCommand)).toHaveLength(exists ? 1 : 0);
      expect(commands(UpdateFunctionConfigurationCommand)).toHaveLength(
        exists ? 1 : 0,
      );
      expect(commands(PublishVersionCommand)).toHaveLength(1);
    },
  );

  test.each([
    { error: throttle(), attempts: 10 },
    {
      error: Object.assign(new Error("Not authorized"), {
        name: "AccessDeniedException",
      }),
      attempts: 1,
    },
  ])(
    "stops checking for the function after $attempts attempts and reports $error.name",
    async ({ error, attempts }) => {
      send.mockRejectedValue(error);
      const result = main().then(
        () => undefined,
        (failure: Error) => failure,
      );
      await vi.runAllTimersAsync();
      expect(await result).toEqual(new Error("Deployment exited with failure"));
      expect(exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith("Deployment failed:", error);
      expect(commands(GetFunctionCommand)).toHaveLength(attempts);
      expect(send).toHaveBeenCalledTimes(attempts);
      expect(logSend).not.toHaveBeenCalled();
    },
  );

  test("retries a throttled readiness poll without recreating or republishing", async () => {
    const normal = send.getMockImplementation()!;
    let polls = 0;
    send.mockImplementation(async (command) => {
      if (
        command instanceof GetFunctionConfigurationCommand &&
        command.input.FunctionName?.endsWith(":$LATEST.PUBLISHED")
      ) {
        if (++polls === 1) throw throttle();
        if (polls === 2) return { ...configuration, State: "Pending" };
      }
      return normal(command);
    });
    await deploy();
    expect(polls).toBe(3);
    expect(commands(CreateFunctionCommand)).toHaveLength(1);
    expect(commands(PublishVersionCommand)).toHaveLength(1);
    expect(commands(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(commands(PutFunctionScalingConfigCommand)).toHaveLength(1);
  });

  test.each([1, 10])(
    "loads configuration before updating a concurrent creation after %i throttles",
    async (throttles) => {
      const normal = send.getMockImplementation()!;
      let reads = 0;
      send.mockImplementation(async (command) => {
        if (command instanceof CreateFunctionCommand) throw conflict();
        if (
          command instanceof GetFunctionConfigurationCommand &&
          ++reads <= throttles
        ) {
          throw throttle();
        }
        return normal(command);
      });
      await deploy();
      expect(commands(CreateFunctionCommand)).toHaveLength(1);
      expect(commands(UpdateFunctionCodeCommand)).toHaveLength(1);
      expect(commands(UpdateFunctionConfigurationCommand)).toHaveLength(1);
      expect(commands(PublishVersionCommand)).toHaveLength(1);
      expect(
        commands(UpdateFunctionConfigurationCommand)[0].input.DurableConfig,
      ).toBeUndefined();
    },
  );

  test.each([
    { existing: false, capacityProvider: false, phaseAttempts: 10 },
    { existing: true, capacityProvider: false, phaseAttempts: 10 },
    { existing: false, capacityProvider: true, phaseAttempts: 120 },
    { existing: true, capacityProvider: true, phaseAttempts: 120 },
  ])(
    "bounds configuration throttles to $phaseAttempts phase attempts (existing=$existing, capacityProvider=$capacityProvider)",
    async ({ existing, capacityProvider, phaseAttempts }) => {
      mockUseCapacityProvider = capacityProvider;
      const normal = send.getMockImplementation()!;
      const throttled = throttle();
      let initialRead = existing;
      let phaseReads = 0;
      send.mockImplementation(async (command) => {
        if (existing && command instanceof GetFunctionCommand) return {};
        if (command instanceof CreateFunctionCommand) throw conflict();
        if (command instanceof GetFunctionConfigurationCommand) {
          if (initialRead) {
            initialRead = false;
            return {
              ...configuration,
              CapacityProviderConfig: capacityProvider ? {} : undefined,
            };
          }
          phaseReads++;
          throw throttled;
        }
        return normal(command);
      });
      const startedAt = Date.now();
      const result = main().then(
        () => undefined,
        (error: Error) => error,
      );
      await vi.runAllTimersAsync();
      expect(await result).toEqual(new Error("Deployment exited with failure"));
      expect(exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        "Deployment failed:",
        throttled,
      );
      expect(phaseReads).toBe(phaseAttempts);
      // Include maximum jitter, but never an extra per-read retry budget.
      expect(Date.now() - startedAt).toBeLessThan(phaseAttempts * 20_250);
      expect(commands(GetFunctionConfigurationCommand)).toHaveLength(
        phaseAttempts + (existing ? 1 : 0),
      );
      expect(commands(CreateFunctionCommand)).toHaveLength(existing ? 0 : 1);
      expect(commands(DeleteFunctionCommand)).toHaveLength(0);
      expect(commands(UpdateFunctionCodeCommand)).toHaveLength(0);
      expect(commands(UpdateFunctionConfigurationCommand)).toHaveLength(0);
      expect(commands(PutRuntimeManagementConfigCommand)).toHaveLength(0);
      expect(commands(PublishVersionCommand)).toHaveLength(0);
      expect(commands(PutFunctionScalingConfigCommand)).toHaveLength(0);
    },
  );

  test.each([false, true])(
    "refreshes configuration on the last phase attempt and preserves later retries (existing=%s)",
    async (existing) => {
      const normal = send.getMockImplementation()!;
      let initialRead = existing;
      let updated = false;
      let phaseReads = 0;
      let publishedPolls = 0;
      let scalingAttempts = 0;
      send.mockImplementation(async (command) => {
        if (existing && command instanceof GetFunctionCommand) return {};
        if (command instanceof CreateFunctionCommand) throw conflict();
        if (command instanceof GetFunctionConfigurationCommand) {
          if (initialRead) {
            initialRead = false;
            return configuration;
          }
          if (!updated) {
            if (++phaseReads < 120) throw throttle();
            return {
              ...configuration,
              DurableConfig: { ExecutionTimeout: 30, RetentionPeriodInDays: 2 },
            };
          }
          if (
            command.input.FunctionName?.endsWith(":$LATEST.PUBLISHED") &&
            ++publishedPolls < 10
          ) {
            throw throttle();
          }
        }
        if (command instanceof UpdateFunctionConfigurationCommand)
          updated = true;
        if (
          command instanceof PutFunctionScalingConfigCommand &&
          ++scalingAttempts === 1
        ) {
          throw throttle();
        }
        return normal(command);
      });
      await deploy();
      expect(phaseReads).toBe(120);
      expect(publishedPolls).toBe(10);
      expect(scalingAttempts).toBe(2);
      expect(commands(CreateFunctionCommand)).toHaveLength(existing ? 0 : 1);
      expect(commands(DeleteFunctionCommand)).toHaveLength(0);
      expect(commands(UpdateFunctionCodeCommand)).toHaveLength(1);
      expect(commands(UpdateFunctionConfigurationCommand)).toHaveLength(1);
      // The initial snapshot matched; the successful phase read must win.
      expect(
        commands(UpdateFunctionConfigurationCommand)[0].input.DurableConfig,
      ).toEqual(configuration.DurableConfig);
      expect(commands(PutRuntimeManagementConfigCommand)).toHaveLength(1);
      expect(commands(PublishVersionCommand)).toHaveLength(1);
    },
  );

  test("retries scaling without repeating a completed create, update, or publish", async () => {
    const normal = send.getMockImplementation()!;
    let scalingAttempts = 0;
    send.mockImplementation(async (command) => {
      if (
        command instanceof PutFunctionScalingConfigCommand &&
        ++scalingAttempts === 1
      ) {
        throw throttle();
      }
      return normal(command);
    });
    await deploy();
    expect(commands(CreateFunctionCommand)).toHaveLength(1);
    expect(commands(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(commands(UpdateFunctionConfigurationCommand)).toHaveLength(0);
    expect(commands(PublishVersionCommand)).toHaveLength(1);
    expect(scalingAttempts).toBe(2);
  });
  test.each([false, true])(
    "stops at the readiness deadline without replaying deployment (existing=%s)",
    async (existing) => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const normal = send.getMockImplementation()!;
      const throttled = throttle();
      let polls = 0;
      send.mockImplementation(async (command) => {
        if (existing && command instanceof GetFunctionCommand) return {};
        if (
          command instanceof GetFunctionConfigurationCommand &&
          command.input.FunctionName?.endsWith(":$LATEST.PUBLISHED")
        ) {
          polls++;
          throw throttled;
        }
        return normal(command);
      });
      const startedAt = Date.now();
      const result = main().then(
        () => undefined,
        (error: Error) => error,
      );
      await vi.runAllTimersAsync();
      expect(await result).toEqual(new Error("Deployment exited with failure"));
      expect(exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        "Deployment failed:",
        throttled,
      );
      // The 900s phase window replaces the former ten-read inner budget.
      // Backoff starts reads at 0, 1, 3, 7, 15, 31, then every 20s through 891s.
      expect(polls).toBe(49);
      expect(Date.now() - startedAt).toBe(900_000);
      expect(commands(CreateFunctionCommand)).toHaveLength(existing ? 0 : 1);
      expect(commands(UpdateFunctionCodeCommand)).toHaveLength(
        existing ? 1 : 0,
      );
      expect(commands(UpdateFunctionConfigurationCommand)).toHaveLength(
        existing ? 1 : 0,
      );
      expect(commands(PublishVersionCommand)).toHaveLength(1);
      expect(commands(PutFunctionScalingConfigCommand)).toHaveLength(0);
    },
  );

  test("stops after ten scaling throttles without repeating earlier phases", async () => {
    const normal = send.getMockImplementation()!;
    const throttled = throttle();
    let attempts = 0;
    send.mockImplementation(async (command) => {
      if (
        command instanceof PutFunctionScalingConfigCommand &&
        ++attempts <= 10
      ) {
        throw throttled;
      }
      return normal(command);
    });
    const result = main().then(
      () => undefined,
      (error: Error) => error,
    );
    await vi.runAllTimersAsync();
    expect(await result).toEqual(new Error("Deployment exited with failure"));
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith("Deployment failed:", throttled);
    expect(attempts).toBe(10);
    expect(commands(CreateFunctionCommand)).toHaveLength(1);
    expect(commands(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(commands(UpdateFunctionConfigurationCommand)).toHaveLength(0);
    expect(commands(PublishVersionCommand)).toHaveLength(1);
  });

  test("retries capacity recovery deletion without repeating create or update", async () => {
    const normal = send.getMockImplementation()!;
    let publications = 0;
    let deletions = 0;
    send.mockImplementation(async (command) => {
      if (command instanceof PublishVersionCommand) publications++;
      if (command instanceof DeleteFunctionCommand) {
        if (++deletions === 1) throw throttle();
      }
      if (
        command instanceof GetFunctionConfigurationCommand &&
        command.input.FunctionName?.endsWith(":$LATEST.PUBLISHED") &&
        publications === 1
      ) {
        if (deletions === 2) {
          throw new ResourceNotFoundException({
            message: "Published version deleted",
            $metadata: {},
          });
        }
        return {
          ...configuration,
          LastUpdateStatus: "Failed",
          LastUpdateStatusReasonCode:
            LastUpdateStatusReasonCode.CapacityProviderScalingLimitExceeded,
        };
      }
      return normal(command);
    });
    await deploy();
    expect(deletions).toBe(2);
    expect(publications).toBe(2);
    expect(commands(CreateFunctionCommand)).toHaveLength(1);
    expect(commands(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(commands(UpdateFunctionConfigurationCommand)).toHaveLength(0);
    expect(commands(PutFunctionScalingConfigCommand)).toHaveLength(1);
  });

  test("fails after both capacity recovery attempts instead of reporting success", async () => {
    const normal = send.getMockImplementation()!;
    let published = false;
    send.mockImplementation(async (command) => {
      if (command instanceof PublishVersionCommand) published = true;
      if (command instanceof DeleteFunctionCommand) published = false;
      if (
        command instanceof GetFunctionConfigurationCommand &&
        command.input.FunctionName?.endsWith(":$LATEST.PUBLISHED")
      ) {
        if (!published)
          throw new ResourceNotFoundException({
            message: "Deleted",
            $metadata: {},
          });
        return {
          ...configuration,
          LastUpdateStatus: "Failed",
          LastUpdateStatusReason: "capacity exhausted",
          LastUpdateStatusReasonCode:
            LastUpdateStatusReasonCode.CapacityProviderScalingLimitExceeded,
        };
      }
      return normal(command);
    });
    const result = main().then(
      () => undefined,
      (error: Error) => error,
    );
    await vi.runAllTimersAsync();
    expect(await result).toEqual(new Error("Deployment exited with failure"));
    expect(commands(CreateFunctionCommand)).toHaveLength(1);
    expect(commands(PublishVersionCommand)).toHaveLength(2);
    expect(commands(DeleteFunctionCommand)).toHaveLength(2);
    expect(commands(PutFunctionScalingConfigCommand)).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(
      "Deployment failed:",
      expect.objectContaining({
        message: expect.stringContaining("capacity exhausted"),
      }),
    );
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining("Successfully deployed"),
    );
  });

  describe("shared polling budgets", () => {
    const phases = [
      {
        phase: "runtime pin",
        attempts: 300,
        throttledReads: 19,
        mixedReads: 28,
      },
      { phase: "readiness", attempts: 900, throttledReads: 49, mixedReads: 83 },
      { phase: "deletion", attempts: 120, throttledReads: 10, mixedReads: 14 },
    ] as const;
    type Phase = (typeof phases)[number]["phase"];
    const pending = {
      ...configuration,
      State: "Pending",
      LastUpdateStatus: "InProgress",
    };

    beforeEach(() => {
      // Make exponential backoff timings exact; the phase deadline also bounds jitter.
      vi.spyOn(Math, "random").mockReturnValue(0);
    });

    function mockPoll(
      phase: Phase,
      read: (attempt: number, abortSignal?: AbortSignal) => unknown,
    ) {
      const normal = send.getMockImplementation()!;
      let polls = 0;
      let publications = 0;
      let deleting = false;
      send.mockImplementation(
        async (command, options?: { abortSignal?: AbortSignal }) => {
          if (command instanceof PublishVersionCommand) {
            publications++;
            deleting = false;
          }
          if (command instanceof DeleteFunctionCommand) deleting = true;
          if (command instanceof GetFunctionConfigurationCommand) {
            const qualified =
              command.input.FunctionName?.endsWith(":$LATEST.PUBLISHED");
            if (
              (phase === "runtime pin" && !qualified) ||
              (phase === "readiness" && qualified) ||
              (phase === "deletion" && qualified && deleting)
            ) {
              return read(++polls, options?.abortSignal);
            }
            if (phase === "deletion" && qualified && publications === 1) {
              return {
                ...configuration,
                LastUpdateStatus: "Failed",
                LastUpdateStatusReasonCode:
                  LastUpdateStatusReasonCode.CapacityProviderScalingLimitExceeded,
              };
            }
          }
          return normal(command);
        },
      );
      return () => polls;
    }

    async function runDeployment() {
      let settled = false;
      const result = main().then(
        () => {
          settled = true;
          return undefined;
        },
        (error: Error) => {
          settled = true;
          return error;
        },
      );
      await vi.runAllTimersAsync();
      // Fail deterministically if a read remains stuck after all budget timers fire.
      expect(settled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      return result;
    }

    function ready(phase: Phase) {
      if (phase === "deletion") {
        throw new ResourceNotFoundException({
          message: "Published version deleted",
          $metadata: {},
        });
      }
      return configuration;
    }

    function expectIsolatedFailure(
      phase: Phase,
      result: Error | undefined,
      error: Error,
    ) {
      if (phase === "runtime pin") {
        // Runtime pinning remains best effort; its failure must not repeat the pin.
        expect(result).toBeUndefined();
        expect(exit).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
          "Failed to pin Managed Instances runtime for deploy-regression:",
          error,
        );
      } else {
        expect(result).toEqual(new Error("Deployment exited with failure"));
        expect(exit).toHaveBeenCalledWith(1);
        expect(console.error).toHaveBeenCalledWith(
          "Deployment failed:",
          error instanceof ResourceConflictException
            ? expect.objectContaining({ cause: error })
            : error,
        );
      }
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(commands(CreateFunctionCommand)).toHaveLength(1);
      expect(commands(UpdateFunctionCodeCommand)).toHaveLength(0);
      expect(commands(UpdateFunctionConfigurationCommand)).toHaveLength(0);
      expect(commands(PutRuntimeManagementConfigCommand)).toHaveLength(1);
      expect(commands(PublishVersionCommand)).toHaveLength(1);
      expect(commands(DeleteFunctionCommand)).toHaveLength(
        phase === "deletion" ? 1 : 0,
      );
      expect(commands(PutFunctionScalingConfigCommand)).toHaveLength(
        phase === "runtime pin" ? 1 : 0,
      );
      expect(
        logSend.mock.calls.map(([command]) => command.constructor),
      ).toEqual([CreateLogGroupCommand, PutRetentionPolicyCommand]);
      expect(logSend.mock.calls[1][0].input).toEqual({
        logGroupName: "/aws/lambda/deploy-regression",
        retentionInDays: 7,
      });
    }

    test.each(phases)(
      "does not reset the $phase deadline after nine throttles and a Pending response",
      async ({ phase, attempts, mixedReads }) => {
        const throttled = throttle();
        const polls = mockPoll(phase, (attempt) => {
          if (attempt % 10 !== 0) throw throttled;
          return pending;
        });
        const startedAt = Date.now();
        const result = await runDeployment();
        // Nine throttles sleep 111s, then Pending sleeps 1s. Every cycle uses
        // the same 300s/900s/120s window, including the final partial cycle.
        expect(polls()).toBe(mixedReads);
        expect(Date.now() - startedAt).toBe(attempts * 1000);
        expectIsolatedFailure(phase, result, throttled);
      },
    );

    test.each(phases)(
      "exhausts the $phase deadline on persistent throttling",
      async ({ phase, attempts, throttledReads }) => {
        const throttled = throttle();
        const polls = mockPoll(phase, () => {
          throw throttled;
        });
        const startedAt = Date.now();
        const result = await runDeployment();
        // Reads start at 0, 1, 3, 7, 15, 31, then every 20 seconds.
        expect(polls()).toBe(throttledReads);
        expect(Date.now() - startedAt).toBe(attempts * 1000);
        expectIsolatedFailure(phase, result, throttled);
      },
    );

    test.each(phases)(
      "counts every conflicting read toward the $phase attempt limit",
      async ({ phase, attempts }) => {
        const conflicted = conflict();
        const polls = mockPoll(phase, () => {
          throw conflicted;
        });
        const startedAt = Date.now();
        const result = await runDeployment();
        expect(polls()).toBe(attempts);
        expect(Date.now() - startedAt).toBe((attempts - 1) * 1000);
        expectIsolatedFailure(phase, result, conflicted);
      },
    );

    test.each(phases)(
      "immediately propagates permanent $phase read errors",
      async ({ phase }) => {
        const denied = Object.assign(new Error("Not authorized"), {
          name: "AccessDeniedException",
        });
        let readSignal: AbortSignal | undefined;
        const polls = mockPoll(phase, (_, signal) => {
          readSignal = signal;
          throw denied;
        });
        const startedAt = performance.now();
        const result = await runDeployment();
        expect(polls()).toBe(1);
        expect(performance.now() - startedAt).toBe(0);
        expectIsolatedFailure(phase, result, denied);
        expect(readSignal?.aborted).toBe(false);
        expect(getEventListeners(readSignal!, "abort")).toHaveLength(0);
      },
    );

    test("counts time spent reading toward readiness without starting another read", async () => {
      const polls = mockPoll("readiness", () => {
        // Advance elapsed time, rather than only changing the wall clock.
        vi.advanceTimersByTime(900_000);
        return pending;
      });
      const startedAt = Date.now();
      const result = await runDeployment();
      expect(polls()).toBe(1);
      expect(Date.now() - startedAt).toBe(900_000);
      expectIsolatedFailure(
        "readiness",
        result,
        new Error("Max retries exceeded"),
      );
    });

    test.each(phases)(
      "bounds an abort-ignoring $phase read and ignores its later completion",
      async ({ phase, attempts }) => {
        let complete!: () => void;
        const response = new Promise<void>((resolve) => {
          complete = resolve;
        });
        let readSignal: AbortSignal | undefined;
        const polls = mockPoll(phase, (_, signal) => {
          readSignal = signal;
          return response.then(() => ready(phase));
        });
        const startedAt = performance.now();
        const result = await runDeployment();
        expect(polls()).toBe(1);
        expect(performance.now() - startedAt).toBe(attempts * 1000);
        expect(readSignal?.aborted).toBe(true);
        expect(readSignal?.reason).toEqual(new Error("Max retries exceeded"));
        expectIsolatedFailure(phase, result, new Error("Max retries exceeded"));

        complete();
        await vi.runAllTimersAsync();
        expect(polls()).toBe(1);
        expectIsolatedFailure(phase, result, new Error("Max retries exceeded"));
        expect(vi.getTimerCount()).toBe(0);
        expect(getEventListeners(readSignal!, "abort")).toHaveLength(0);
      },
    );

    test.each(phases)(
      "aborts an in-flight $phase request without leaking its abort error",
      async ({ phase, attempts }) => {
        const aborted = vi.fn();
        let readSignal: AbortSignal | undefined;
        const polls = mockPoll(phase, (_, signal) => {
          readSignal = signal;
          return new Promise<never>((_, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                aborted();
                reject(
                  Object.assign(new Error("Request aborted"), {
                    name: "AbortError",
                  }),
                );
              },
              { once: true },
            );
          });
        });
        const startedAt = performance.now();
        const result = await runDeployment();
        expect(polls()).toBe(1);
        expect(performance.now() - startedAt).toBe(attempts * 1000);
        expect(aborted).toHaveBeenCalledTimes(1);
        expectIsolatedFailure(phase, result, new Error("Max retries exceeded"));
        expect(getEventListeners(readSignal!, "abort")).toHaveLength(0);
      },
    );

    test.each(
      phases.flatMap((phase) => [
        { ...phase, lateByMs: 0 },
        { ...phase, lateByMs: 1 },
      ]),
    )(
      "rejects $phase success $lateByMs ms beyond expiry even before the timeout callback runs",
      async ({ phase, attempts, lateByMs }) => {
        const clock = vi.spyOn(performance, "now").mockReturnValue(0);
        let readSignal: AbortSignal | undefined;
        const polls = mockPoll(phase, (_, signal) => {
          readSignal = signal;
          // Model a response completing after an event-loop stall, before the
          // overdue timeout callback gets a chance to run.
          clock.mockReturnValue(attempts * 1000 + lateByMs);
          return ready(phase);
        });
        const result = await runDeployment();
        expect(polls()).toBe(1);
        expect(readSignal?.aborted).toBe(true);
        expectIsolatedFailure(phase, result, new Error("Max retries exceeded"));
      },
    );

    test.each(phases)(
      "uses only the remaining $phase budget for a stalled retry and preserves the last error",
      async ({ phase, attempts }) => {
        const throttled = throttle();
        const readSignals: Array<AbortSignal | undefined> = [];
        const polls = mockPoll(phase, (attempt, signal) => {
          readSignals.push(signal);
          if (attempt === 1) throw throttled;
          return new Promise<never>(() => {});
        });
        const startedAt = performance.now();
        const result = await runDeployment();
        expect(polls()).toBe(2);
        expect(performance.now() - startedAt).toBe(attempts * 1000);
        expect(readSignals[0]?.aborted).toBe(false);
        expect(readSignals[1]?.aborted).toBe(true);
        expect(readSignals[1]?.reason).toBe(throttled);
        expectIsolatedFailure(phase, result, throttled);
      },
    );

    test.each(
      phases.flatMap((phase) => [
        { ...phase, clockStepMs: -3_600_000 },
        { ...phase, clockStepMs: 3_600_000 },
      ]),
    )(
      "keeps the $phase deadline when wall time steps $clockStepMs ms during retry sleep",
      async ({ phase, attempts, throttledReads, clockStepMs }) => {
        const throttled = throttle();
        const polls = mockPoll(phase, (attempt) => {
          if (attempt === 1) {
            setTimeout(() => vi.setSystemTime(Date.now() + clockStepMs), 500);
          }
          throw throttled;
        });
        const startedAt = performance.now();
        const result = await runDeployment();
        expect(polls()).toBe(throttledReads);
        expect(performance.now() - startedAt).toBe(attempts * 1000);
        expectIsolatedFailure(phase, result, throttled);
      },
    );

    test.each(phases)(
      "clears the $phase request timeout after timely success",
      async ({ phase }) => {
        let readSignal: AbortSignal | undefined;
        const polls = mockPoll(phase, (_, signal) => {
          readSignal = signal;
          return ready(phase);
        });
        const startedAt = performance.now();
        const result = await runDeployment();
        expect(result).toBeUndefined();
        expect(exit).not.toHaveBeenCalled();
        expect(polls()).toBe(1);
        expect(performance.now() - startedAt).toBe(0);
        expect(readSignal?.aborted).toBe(false);
        expect(getEventListeners(readSignal!, "abort")).toHaveLength(0);
        expect(commands(CreateFunctionCommand)).toHaveLength(1);
        expect(commands(PublishVersionCommand)).toHaveLength(
          phase === "deletion" ? 2 : 1,
        );
      },
    );

    test("caps throttle jitter at the readiness deadline", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0.999);
      const throttled = throttle();
      const polls = mockPoll("readiness", () => {
        throw throttled;
      });
      const startedAt = Date.now();
      const result = await runDeployment();
      expect(polls()).toBe(48);
      expect(Date.now() - startedAt).toBe(900_000);
      expectIsolatedFailure("readiness", result, throttled);
    });

    test("accepts readiness on the last allowed poll without republishing", async () => {
      const polls = mockPoll("readiness", (attempt) =>
        attempt < 900 ? pending : configuration,
      );
      await deploy();
      expect(polls()).toBe(900);
      expect(commands(CreateFunctionCommand)).toHaveLength(1);
      expect(commands(PublishVersionCommand)).toHaveLength(1);
      expect(commands(PutFunctionScalingConfigCommand)).toHaveLength(1);
    });

    test("retries deletion reads until NotFound before the one allowed recovery publish", async () => {
      const polls = mockPoll("deletion", (attempt) => {
        if (attempt === 1) throw throttle();
        if (attempt === 2) return pending;
        if (attempt === 3) throw conflict();
        throw new ResourceNotFoundException({
          message: "Published version deleted",
          $metadata: {},
        });
      });
      await deploy();
      expect(polls()).toBe(4);
      expect(commands(CreateFunctionCommand)).toHaveLength(1);
      expect(commands(UpdateFunctionCodeCommand)).toHaveLength(0);
      expect(commands(UpdateFunctionConfigurationCommand)).toHaveLength(0);
      expect(commands(PutRuntimeManagementConfigCommand)).toHaveLength(1);
      expect(commands(PublishVersionCommand)).toHaveLength(2);
      expect(commands(DeleteFunctionCommand)).toHaveLength(1);
      expect(commands(PutFunctionScalingConfigCommand)).toHaveLength(1);
    });
  });

  test("keeps the standalone initial read limited to ten attempts", async () => {
    const normal = send.getMockImplementation()!;
    const throttled = throttle();
    send.mockImplementation(async (command) => {
      if (command instanceof GetFunctionCommand) return {};
      if (command instanceof GetFunctionConfigurationCommand) throw throttled;
      return normal(command);
    });
    const result = main().then(
      () => undefined,
      (error: Error) => error,
    );
    await vi.runAllTimersAsync();
    expect(await result).toEqual(new Error("Deployment exited with failure"));
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith("Deployment failed:", throttled);
    expect(commands(GetFunctionConfigurationCommand)).toHaveLength(10);
    expect(commands(CreateFunctionCommand)).toHaveLength(0);
    expect(commands(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(commands(PublishVersionCommand)).toHaveLength(0);
  });

  test("does not retry or hide a permanent configuration error", async () => {
    const normal = send.getMockImplementation()!;
    const denied = Object.assign(new Error("Not authorized"), {
      name: "AccessDeniedException",
    });
    send.mockImplementation(async (command) => {
      if (command instanceof CreateFunctionCommand) throw conflict();
      if (command instanceof GetFunctionConfigurationCommand) throw denied;
      return normal(command);
    });
    const result = main().then(
      () => undefined,
      (error: Error) => error,
    );
    await vi.runAllTimersAsync();
    expect(await result).toEqual(new Error("Deployment exited with failure"));
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith("Deployment failed:", denied);
    expect(commands(GetFunctionConfigurationCommand)).toHaveLength(1);
    expect(commands(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(commands(PublishVersionCommand)).toHaveLength(0);
  });
});
