import {
  LocalDurableTestRunner,
  CloudDurableTestRunner,
  DurableTestRunner,
  DurableOperation,
  LocalTestRunnerHandlerFunction,
} from "aws-durable-execution-sdk-js-testing";

export interface TestDefinition<ResultType> {
  name: string;
  functionName: string;
  handler: LocalTestRunnerHandlerFunction;
  tests: (
    runner: DurableTestRunner<DurableOperation<unknown>, ResultType>
  ) => void;
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
        `Function name ${testDef.functionName} not found in FUNCTION_NAME_MAP`
      );
    }

    const runner = new CloudDurableTestRunner<ResultType>({
      functionName,
      config: {
        endpoint: process.env.LAMBDA_ENDPOINT,
      },
    });

    describe(`${testDef.name} (cloud)`, () => {
      testDef.tests(runner);
    });
    return;
  }

  describe(`${testDef.name} (local)`, () => {
    beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
    afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

    const runner: LocalDurableTestRunner<ResultType> =
      new LocalDurableTestRunner({
        handlerFunction: testDef.handler,
        skipTime: true,
      });

    beforeEach(() => {
      // TODO: fix the testing library to allow the same runner to run multiple times on the same handler
      // instead of needing to reset the operation storage
      runner.reset();
    });

    testDef.tests(runner);
  });
}
