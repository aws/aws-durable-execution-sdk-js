import { LocalDurableTestRunner } from "aws-durable-execution-sdk-js-testing";
import { handler } from "../wait-named";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("wait-named test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });

    it("should call wait for 5 seconds", async () => {
        const execution = await durableTestRunner.run();
        const waitOp = durableTestRunner.getOperation("wait-5-seconds");

        expect(execution.getResult()).toBe("wait finished");
        expect(waitOp.getWaitDetails()?.waitSeconds).toEqual(5);
    });
});
