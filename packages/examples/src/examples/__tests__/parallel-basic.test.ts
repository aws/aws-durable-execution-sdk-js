import {LocalDurableTestRunner} from "@amzn/durable-executions-type-script-testing-library";
import {handler} from "../parallel-basic";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("parallel-basic test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    })

    it("should run correct number of durable steps", async () => {
       const execution = await durableTestRunner.run();

       expect(durableTestRunner.getOperation("parallel").getChildOperations()).toHaveLength(3);
    });

    it("should return correct result", async () => {
        const execution = await durableTestRunner.run();

        const result = execution.getResult();

        expect(execution.getResult()).toBeDefined();
    });
})