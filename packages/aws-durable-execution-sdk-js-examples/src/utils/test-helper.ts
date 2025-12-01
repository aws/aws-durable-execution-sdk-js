import { LambdaClient } from "@aws-sdk/client-lambda";
import { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  CloudDurableTestRunner,
  DurableTestRunner,
  DurableOperation,
  InvocationType,
} from "@aws/durable-execution-sdk-js-testing";

type TestCallback<ResultType> = (
  runner: DurableTestRunner<DurableOperation<unknown>, ResultType>,
  isCloud: boolean,
  functionNameMap: FunctionNameMap,
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
      testDef.tests(runner, true, new CloudFunctionNameMap(functionNames));
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

    testDef.tests(runner, false, new LocalFunctionNameMap());
  });
}
