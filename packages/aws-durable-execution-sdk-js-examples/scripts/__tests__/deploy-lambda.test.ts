import {
  LambdaClient,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  PublishVersionCommand,
  PutFunctionScalingConfigCommand,
  DeleteFunctionCommand,
  LastUpdateStatusReasonCode,
  ResourceNotFoundException,
  ResourceConflictException,
} from "@aws-sdk/client-lambda";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { main } from "../deploy-lambda";

jest.mock("@aws-sdk/client-lambda", () => ({
  ...jest.requireActual("@aws-sdk/client-lambda"),
  LambdaClient: jest.fn(),
}));
jest.mock("@aws-sdk/client-cloudwatch-logs", () => ({
  ...jest.requireActual("@aws-sdk/client-cloudwatch-logs"),
  CloudWatchLogsClient: jest.fn(),
}));
jest.mock("argparse", () => ({
  ArgumentParser: jest.fn(() => ({
    add_argument: jest.fn(),
    parse_args: () => ({
      example: "step-basic",
      function_name: "deploy-regression",
      runtime: "24.x",
      use_capacity_provider: true,
    }),
  })),
}));
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: () => true,
  readFileSync: () => Buffer.from("mock deployment archive"),
}));
jest.mock(
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
  let send: jest.Mock;
  let exit: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.replaceProperty(process, "env", {
      ...process.env,
      AWS_ACCOUNT_ID: "123456789012",
      AWS_REGION: "us-west-2",
      LAMBDA_EXECUTION_ROLE_ARN: "arn:aws:iam::123456789012:role/test",
      CAPACITY_PROVIDER_ARN:
        "arn:aws:lambda:us-west-2:123456789012:capacity-provider:test",
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    exit = jest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Deployment exited with failure");
    });
    send = jest.fn(async (command) => {
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
    (LambdaClient as unknown as jest.Mock).mockImplementation(() => ({ send }));
    (CloudWatchLogsClient as unknown as jest.Mock).mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({}),
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function deploy() {
    const result = main().then(
      () => undefined,
      (error: Error) => error,
    );
    await jest.runAllTimersAsync();
    expect(await result).toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  }

  function commands<T>(type: new (input: never) => T): T[] {
    return send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof type);
  }

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
    "stops after ten post-publish read failures without replaying deployment (existing=%s)",
    async (existing) => {
      const normal = send.getMockImplementation()!;
      const throttled = throttle();
      let polls = 0;
      send.mockImplementation(async (command) => {
        if (existing && command instanceof GetFunctionCommand) return {};
        if (
          command instanceof GetFunctionConfigurationCommand &&
          command.input.FunctionName?.endsWith(":$LATEST.PUBLISHED") &&
          ++polls <= 10
        ) {
          throw throttled;
        }
        return normal(command);
      });
      const result = main().then(
        () => undefined,
        (error: Error) => error,
      );
      await jest.runAllTimersAsync();
      expect(await result).toEqual(new Error("Deployment exited with failure"));
      expect(exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        "Deployment failed:",
        throttled,
      );
      expect(polls).toBe(10);
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
    await jest.runAllTimersAsync();
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
    await jest.runAllTimersAsync();
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
    await jest.runAllTimersAsync();
    expect(await result).toEqual(new Error("Deployment exited with failure"));
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith("Deployment failed:", denied);
    expect(commands(GetFunctionConfigurationCommand)).toHaveLength(1);
    expect(commands(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(commands(PublishVersionCommand)).toHaveLength(0);
  });
});
