import { loggerExample } from "./logger-example";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";

const handler = withDurableExecution(loggerExample);

describe("logger-example test (local)", () => {
  beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  const runner = new LocalDurableTestRunner({
    handlerFunction: handler,
    skipTime: true,
  });

  beforeEach(() => {
    runner.reset();
  });

  it("should execute successfully with logger", async () => {
    const execution = await runner.run();

    expect(execution.getResult()).toEqual("processed-child-processed");
  });
});
