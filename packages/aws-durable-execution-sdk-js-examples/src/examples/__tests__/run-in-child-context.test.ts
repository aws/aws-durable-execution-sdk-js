import {LocalDurableTestRunner} from "aws-durable-execution-sdk-js-testing";
import {handler} from "../run-in-child-context";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("run-in-child-context test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });

    it("should return correct result", async () => {
       const execution = await durableTestRunner.run();

       expect(execution.getResult()).toBe("child step completed");
    });

    it("parent should return result from child", async () => {
        const RESULT = "res";

        const parentOp = durableTestRunner.getOperationByIndex(0);
        const childOp = durableTestRunner.getOperationByIndex(1);

        childOp.mockResolvedValue(RESULT);

        await durableTestRunner.run();

        expect(parentOp.getChildOperations()).toHaveLength(1);
        expect(parentOp.getContextDetails()?.result).toBe(RESULT);
    });
});