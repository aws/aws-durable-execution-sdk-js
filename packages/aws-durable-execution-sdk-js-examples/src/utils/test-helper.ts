import { LambdaClient, Event, EventType } from "@aws-sdk/client-lambda";
import { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  CloudDurableTestRunner,
  DurableTestRunner,
  DurableOperation,
  InvocationType,
} from "@aws/durable-execution-sdk-js-testing";

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
  name: string;
  functionName: string;
  handler: DurableLambdaHandler;
  tests: TestCallback<ResultType>;
  invocationType?: InvocationType;
  localRunnerConfig?: {
    skipTime?: boolean;
  };
}

export interface TestHelper {
  isTimeSkipping: boolean;
  isCloud: boolean;
  assertEventSignatures(
    actualEvents: Event[],
    expectedEvents: EventSignature[],
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
) {
  const actualCounts = countEventSignatures(actualEvents, isTimeSkipping);
  const expectedCounts = countEventSignatures(expectedEvents, isTimeSkipping);

  expect(actualCounts).toEqual(expectedCounts);
}

/**
 * Creates tests that automatically run with the appropriate test runner
 * based on the environment variables passed in.
 */
export function createTests<ResultType>(testDef: TestDefinition<ResultType>) {
  const isIntegrationTest = process.env.NODE_ENV === "integration";
  const isTimeSkipping =
    (testDef.localRunnerConfig?.skipTime ?? true) && !isIntegrationTest;

  let calledAssertEventSignature = false;
  const testHelper: TestHelper = {
    isTimeSkipping,
    isCloud: isIntegrationTest,
    assertEventSignatures: (actualEvents, expectedEvents) => {
      calledAssertEventSignature = true;
      return assertEventSignatures(
        actualEvents,
        expectedEvents,
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
        `assertEventSignature was not called for test ${testDef.name}`,
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
    const functionName = functionNames[testDef.functionName];
    if (!functionName) {
      throw new Error(
        `Function name ${testDef.functionName} not found in FUNCTION_NAME_MAP`,
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

    describe(`${testDef.name} (cloud)`, () => {
      testDef.tests(runner, testHelper);
    });
    return;
  }

  describe(`${testDef.name} (local)`, () => {
    beforeAll(() =>
      LocalDurableTestRunner.setupTestEnvironment({
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
