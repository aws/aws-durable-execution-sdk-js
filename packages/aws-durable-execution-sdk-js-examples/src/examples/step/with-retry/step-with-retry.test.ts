import {
  LocalDurableTestRunner,
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./step-with-retry";

const EXPECTED_RESULT = "step succeeded";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("step-with-retry test", () => {
  const durableTestRunner = new LocalDurableTestRunner({
    handlerFunction: handler,
  });

  it("should return expected result - happy case", async () => {
    jest.spyOn(Math, "random").mockReturnValue(1);
    const execution = await durableTestRunner.run();

    expect(execution.getResult()).toStrictEqual(EXPECTED_RESULT);

    // verify that durable step was executed
    const stepOp = durableTestRunner.getOperationByIndex(0);
    expect(stepOp.getStepDetails()?.result).toBeDefined();
  });

  it("should execute the step upon retry - happy case", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.1).mockReturnValue(1);
    const execution = await durableTestRunner.run();

    expect(execution.getResult()).toStrictEqual(EXPECTED_RESULT);

    // verify durable step was executed only once
    const stepOp = durableTestRunner.getOperationByIndex(0);
    expect(stepOp.getStepDetails()?.result).toBeDefined();
  });

  it("should retry until all attempts fail - failure case", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.1);
    const execution = await durableTestRunner.run();

    expect(execution.getError()).toBeDefined();

    // verify durable step completed with an error
    const stepOp = durableTestRunner.getOperationByIndex(0);
    expect(stepOp.getStepDetails()?.error).toBeDefined();
  });

  it("should track retry attempts and success details", async () => {
    // Mock to fail twice, then succeed
    jest
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.1)
      .mockReturnValue(1);

    const execution = await durableTestRunner.run();
    const retryStepOp = durableTestRunner.getOperationByIndex(0);

    // The step should eventually succeed
    expect(execution.getResult()).toBe(EXPECTED_RESULT);

    // Verify operation details
    expect(retryStepOp.getType()).toBe(OperationType.STEP);
    expect(retryStepOp.getStatus()).toBe(OperationStatus.SUCCEEDED);

    // Verify retry details are tracked
    const stepDetails = retryStepOp.getStepDetails();
    expect(stepDetails).toBeDefined();
    expect(stepDetails?.result).toEqual(EXPECTED_RESULT);

    execution.print();

    // Verify retry attempt tracking (should be 2 attempts before success)
    expect(typeof stepDetails?.attempt).toBe("number");
    expect(stepDetails?.attempt).toBeGreaterThanOrEqual(1);
    expect(stepDetails?.attempt).toBeLessThanOrEqual(3);
  });
});
