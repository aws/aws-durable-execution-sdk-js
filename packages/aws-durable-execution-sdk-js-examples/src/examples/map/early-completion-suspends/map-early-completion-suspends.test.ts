import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { handler } from "./map-early-completion-suspends";

describe("map early completion: the invocation still suspends", () => {
  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  it.each([
    ["default serdes", false],
    ["slow item deserializer", true],
  ])("%s", async (_name, slowDeserialize) => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = await runner.run({ payload: { slowDeserialize } });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual([0]);
    // The wait after the map suspended the first invocation. A step left
    // EXECUTING by a dropped checkpoint would block that, and the first
    // invocation would run on to the end.
    expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);
  });
});
