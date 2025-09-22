import { LocalDurableTestRunner} from "aws-durable-execution-sdk-js-testing";
import { handler } from '../step-basic';

const RESULT = "res";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("step-basic test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });

    it("should execute step and return correct result", async () => {
        durableTestRunner.getOperationByIndex(0).mockResolvedValue(RESULT);

        const execution = await durableTestRunner.run();

        expect(execution.getOperations()).toHaveLength(1);
        expect(execution.getResult()).toStrictEqual(RESULT);
    });
});