import { LocalDurableTestRunner} from "aws-durable-execution-sdk-js-testing";
import { handler } from '../wait-for-condition';

// TODO: enable test when waitForCondition SDK implementation is fixed

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("wait-for-condition test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });

    it("should invoke step three times before succeeding", async () => {
        const execution = await durableTestRunner.run();
        console.log(execution.getInvocations());
        expect(execution.getResult()).toStrictEqual(3)
        expect(execution.getInvocations()).toHaveLength(3);
    });
});