import { CloudDurableTestRunner } from "@amzn/durable-executions-type-script-testing-library";

if (!process.env.FUNCTION_NAME_MAP) {
  throw new Error("FUNCTION_NAME_MAP is not set");
}

const functionNames = JSON.parse(process.env.FUNCTION_NAME_MAP!);

describe("step-basic test", () => {
  const durableTestRunner = new CloudDurableTestRunner({
    functionName: functionNames["step-basic"],
    config: {
      endpoint: process.env.LAMBDA_ENDPOINT,
    },
  });

  it("should execute step and return correct result", async () => {
    const execution = await durableTestRunner.run();

    expect(execution.getOperations()).toHaveLength(1);
    expect(durableTestRunner.getOperationByIndex(0).getStepDetails()).toEqual({
      result: "step completed",
    });
    expect(execution.getResult()).toStrictEqual("step completed");
  });
});
