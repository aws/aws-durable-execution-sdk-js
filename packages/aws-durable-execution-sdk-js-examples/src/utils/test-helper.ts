import { LambdaClient, Event, EventType } from "@aws-sdk/client-lambda";
import { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  CloudDurableTestRunner,
  DurableTestRunner,
  DurableOperation,
  InvocationType,
  LocalDurableTestRunnerSetupParameters,
  TestResult,
} from "@aws/durable-execution-sdk-js-testing";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export interface FunctionNameMap {
  getFunctionName(functionName: string): string;
}

class CloudFunctionNameMap implements FunctionNameMap {
  constructor(private readonly functionNameMap: Record<string, string>) {}

  getFunctionName(functionName: string): string {
    return this.functionNameMap[functionName];
  }
}

class LocalFunctionNameMap implements FunctionNameMap {
  getFunctionName(functionName: string): string {
    return functionName;
  }
}

type TestCallback<ResultType> = (
  runner: DurableTestRunner<DurableOperation<unknown>, ResultType>,
  testHelper: TestHelper,
) => void;

export interface TestDefinition<ResultType> {
  handler: DurableLambdaHandler;
  tests: TestCallback<ResultType>;
  invocationType?: InvocationType;
  localRunnerConfig?: LocalDurableTestRunnerSetupParameters;
}

export interface EventSignatureConfig {
  /**
   * Due to API delays or other conditions, the number of invocations can change.
   * This property sets a threshold where the number of invocations in the actual history
   * must be in a specified range based on the expected history.
   */
  invocationCompletedDifference?: number;
}

export interface TestHelper {
  isTimeSkipping: boolean;
  isCloud: boolean;
  assertEventSignatures(
    testResult: TestResult,
    suffix?: string,
    eventSignatureConfig?: EventSignatureConfig,
  ): void;
  functionNameMap: FunctionNameMap;
}

export type EventSignature = {
  EventType?: string;
  SubType?: string;
  Name?: string;
};

function createEventSignature(event: EventSignature) {
  const signature: EventSignature = {
    EventType: event.EventType,
    SubType: event.SubType,
    // TODO: add more to the event signature such as
    // - wait duration
    // - result/error
    // - step attempt
  };

  // Only include Name for events that have stable names (not ExecutionStarted/ExecutionSucceeded)
  if (
    event.EventType !== "ExecutionStarted" &&
    event.EventType !== "ExecutionSucceeded" &&
    event.EventType !== "ExecutionFailed" &&
    event.Name
  ) {
    signature.Name = event.Name;
  }

  return signature;
}

// Count occurrences of each event signature
function countEventSignatures(
  events: EventSignature[],
  isTimeSkipping: boolean,
) {
  const counts = new Map();
  events.forEach((event) => {
    const signature = JSON.stringify(createEventSignature(event));
    let count: number;
    if (event.EventType === EventType.InvocationCompleted && isTimeSkipping) {
      // Time skipping can result in a different number of completed invocations due to concurrent
      // logic and early completion of branches in some cases. We will only validate that the
      // InvocationCompleted event exists when time skipping is enabled.
      count = -1;
    } else {
      count = (counts.get(signature) || 0) + 1;
    }
    counts.set(signature, count);
  });
  return counts;
}

function assertEventSignatures(
  actualEvents: Event[],
  expectedEvents: EventSignature[],
  isTimeSkipping: boolean = false,
  eventSignatureConfig?: EventSignatureConfig,
) {
  const actualCounts = countEventSignatures(actualEvents, isTimeSkipping);
  const expectedCounts = countEventSignatures(expectedEvents, isTimeSkipping);

  if (eventSignatureConfig?.invocationCompletedDifference) {
    const invocationCompletedSignature = JSON.stringify(
      createEventSignature({ EventType: EventType.InvocationCompleted }),
    );

    const actualInvocationCompleted = actualCounts.get(
      invocationCompletedSignature,
    );
    actualCounts.delete(invocationCompletedSignature);

    const expectedInvocationsCompleted = expectedCounts.get(
      invocationCompletedSignature,
    );
    expectedCounts.delete(invocationCompletedSignature);

    const invocationCompletedDifference = Math.abs(
      actualInvocationCompleted - expectedInvocationsCompleted,
    );
    expect(invocationCompletedDifference).toBeLessThanOrEqual(
      eventSignatureConfig.invocationCompletedDifference,
    );
  }

  expect(actualCounts).toEqual(expectedCounts);
}

/**
 * Find the file path of the caller of createTests
 */
function getCallerFile(): string {
  const stack = new Error().stack;
  const stackLines = stack?.split("\n") || [];

  // Skip the first line (error message) and find first line not in test-helper
  for (let i = 1; i < stackLines.length; i++) {
    const line = stackLines[i];
    // Match file paths in stack trace
    const match =
      line.match(/\((.+?):\d+:\d+\)/) || line.match(/at (.+?):\d+:\d+/);

    if (match && !match[1].includes("test-helper")) {
      return match[1];
    }
  }

  throw new Error("Could not determine caller file from stack trace");
}

/**
 * Creates tests that automatically run with the appropriate test runner
 * based on the environment variables passed in.
 */
export function createTests<ResultType>(testDef: TestDefinition<ResultType>) {
  const isIntegrationTest = process.env.NODE_ENV === "integration";
  const generateHistories = process.env.GENERATE_HISTORY === "true";
  const isTimeSkipping =
    (testDef.localRunnerConfig?.skipTime ?? true) && !isIntegrationTest;

  if (generateHistories && isTimeSkipping && !isIntegrationTest) {
    console.warn("Disabling skipTime since GENERATE_HISTORY is true");
    jest.setTimeout(120000);
  }

  const testFileName = getCallerFile();
  const parsedFunctionName = path.basename(testFileName, ".test.ts");

  let calledAssertEventSignature = false;
  const testHelper: TestHelper = {
    isTimeSkipping: isTimeSkipping && !generateHistories,
    isCloud: isIntegrationTest,
    assertEventSignatures: (
      testResult: TestResult,
      suffix,
      eventSignatureConfig,
    ) => {
      calledAssertEventSignature = true;

      const historyFileBasename = suffix
        ? `${parsedFunctionName}-${suffix}`
        : parsedFunctionName;

      const historyFilePath = path.join(
        path.dirname(testFileName),
        `${historyFileBasename}.history.json`,
      );

      if (generateHistories) {
        if (!existsSync(historyFilePath)) {
          console.log(`Generated missing history for ${historyFileBasename}`);
          writeFileSync(
            historyFilePath,
            JSON.stringify(testResult.getHistoryEvents(), null, 2),
          );
          return;
        }
      }

      if (!existsSync(historyFilePath)) {
        throw new Error(
          `History file ${historyFilePath} does not exist. Please run the test with GENERATE_HISTORY=true to generate it.`,
        );
      }

      return assertEventSignatures(
        testResult.getHistoryEvents(),
        JSON.parse(readFileSync(historyFilePath).toString("utf-8")),
        testHelper.isTimeSkipping,
        eventSignatureConfig,
      );
    },
    functionNameMap: isIntegrationTest
      ? new CloudFunctionNameMap(JSON.parse(process.env.FUNCTION_NAME_MAP!))
      : new LocalFunctionNameMap(),
  };

  afterAll(() => {
    if (!calledAssertEventSignature) {
      throw new Error(
        `assertEventSignature was not called for test ${parsedFunctionName}`,
      );
    }
  });

  if (isIntegrationTest) {
    if (!process.env.FUNCTION_NAME_MAP) {
      throw new Error("FUNCTION_NAME_MAP is not set for integration tests");
    }

    const functionNames = JSON.parse(process.env.FUNCTION_NAME_MAP!) as Record<
      string,
      string
    >;
    const functionName = functionNames[parsedFunctionName];
    if (!functionName) {
      throw new Error(
        `Function name ${parsedFunctionName} not found in FUNCTION_NAME_MAP`,
      );
    }

    const runner = new CloudDurableTestRunner<ResultType>({
      functionName,
      client: new LambdaClient({
        endpoint: process.env.LAMBDA_ENDPOINT,
      }),
      config: {
        invocationType: testDef.invocationType,
      },
    });

    beforeEach(() => {
      // TODO: fix the testing library to allow the same runner to run multiple times on the same handler
      // instead of needing to reset the operation storage
      runner.reset();
    });

    describe(`${parsedFunctionName} (cloud)`, () => {
      testDef.tests(runner, testHelper);
    });
    return;
  }

  describe(`${parsedFunctionName} (local)`, () => {
    beforeAll(() =>
      LocalDurableTestRunner.setupTestEnvironment({
        ...testDef.localRunnerConfig,
        skipTime: testHelper.isTimeSkipping,
      }),
    );
    afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

    const runner: LocalDurableTestRunner<ResultType> =
      new LocalDurableTestRunner({
        handlerFunction: testDef.handler,
      });

    beforeEach(() => {
      // TODO: fix the testing library to allow the same runner to run multiple times on the same handler
      // instead of needing to reset the operation storage
      runner.reset();
    });

    testDef.tests(runner, testHelper);
  });
}
