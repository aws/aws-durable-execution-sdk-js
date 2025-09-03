import { LocalDurableTestRunner } from "@amzn/durable-executions-type-script-testing-library";
import { handler } from "../wait";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("wait", () => {
  const durableTestRunner = new LocalDurableTestRunner({
    handlerFunction: handler,
    skipTime: true,
  });

  it("should call wait for 10 seconds", async () => {
    const waitStep = durableTestRunner.getOperationByIndex(0);

    const execution = await durableTestRunner.run();

    expect(execution.getResult()).toBe("Function Completed");
    expect(waitStep.getWaitDetails()?.waitSeconds).toEqual(10);
  });
});
