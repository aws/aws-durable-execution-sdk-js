import {LocalDurableTestRunner} from "aws-durable-execution-sdk-js-testing";
import {handler} from "../hello-world";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("hello-world test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });

    it("should return as expected", async () => {
        const execution = await durableTestRunner.run();

        expect(execution.getResult()).toEqual("Hello World!");
    });
});