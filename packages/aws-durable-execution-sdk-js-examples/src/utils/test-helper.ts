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
import { readFileSync } from "fs";
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

export interface TestHelper {
  isTimeSkipping: boolean;
  isCloud: boolean;
  assertEventSignatures(testResult: TestResult, suffix?: string): void;
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
) {
  const actualCounts = countEventSignatures(actualEvents, isTimeSkipping);
  const expectedCounts = countEventSignatures(expectedEvents, isTimeSkipping);

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
  const isTimeSkipping =
    (testDef.localRunnerConfig?.skipTime ?? true) && !isIntegrationTest;

  const testFileName = getCallerFile();
  const parsedFunctionName = path.basename(testFileName, ".test.ts");
  let calledAssertEventSignature = false;
  const testHelper: TestHelper = {
    isTimeSkipping,
    isCloud: isIntegrationTest,
    assertEventSignatures: (testResult: TestResult, suffix) => {
      calledAssertEventSignature = true;

      const historyFileBasename = suffix
        ? `${parsedFunctionName}-${suffix}`
        : parsedFunctionName;

      const historyFilePath = path.join(
        path.dirname(testFileName),
        `${historyFileBasename}.history.json`,
      );
      return assertEventSignatures(
        testResult.getHistoryEvents(),
        JSON.parse(readFileSync(historyFilePath).toString("utf-8")),
        testHelper.isTimeSkipping,
      );
    },
    functionNameMap: isIntegrationTest
      ? new CloudFunctionNameMap(JSON.parse(process.env.FUNCTION_NAME_MAP!))
      : new LocalFunctionNameMap(),
  };

  afterAll(() => {
    if (!calledAssertEventSignature) {
      console.warn(
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
        skipTime: isTimeSkipping,
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
