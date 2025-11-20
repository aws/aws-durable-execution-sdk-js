import {
  LocalDurableTestRunner,
  CloudDurableTestRunner,
  DurableTestRunner,
  DurableOperation,
  LocalTestRunnerHandlerFunction,
  InvocationType,
} from "@aws/durable-execution-sdk-js-testing";

export interface TestDefinition<ResultType> {
  name: string;
  functionName: string;
  handler: LocalTestRunnerHandlerFunction;
  tests: (
    runner: DurableTestRunner<DurableOperation<unknown>, ResultType>,
    isCloud: boolean,
  ) => void;
  invocationType?: InvocationType;
  localRunnerConfig?: {
    skipTime?: boolean;
  };
}

/**
 * Creates tests that automatically run with the appropriate test runner
 * based on the environment variables passed in.
 */
export function createTests<ResultType>(testDef: TestDefinition<ResultType>) {
  const isIntegrationTest = process.env.NODE_ENV === "integration";
  if (isIntegrationTest) {
    if (!process.env.FUNCTION_NAME_MAP) {
      throw new Error("FUNCTION_NAME_MAP is not set for integration tests");
    }

    const functionNames = JSON.parse(process.env.FUNCTION_NAME_MAP!);
    const functionName = functionNames[testDef.functionName];
    if (!functionName) {
      throw new Error(
        `Function name ${testDef.functionName} not found in FUNCTION_NAME_MAP`,
      );
    }

    const runner = new CloudDurableTestRunner<ResultType>({
      functionName,
      clientConfig: {
        endpoint: process.env.LAMBDA_ENDPOINT,
      },
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
      testDef.tests(runner, true);
    });
    return;
  }

  describe(`${testDef.name} (local)`, () => {
    beforeAll(() =>
      LocalDurableTestRunner.setupTestEnvironment({
        skipTime: testDef.localRunnerConfig?.skipTime ?? true,
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

    testDef.tests(runner, false);
  });
}
