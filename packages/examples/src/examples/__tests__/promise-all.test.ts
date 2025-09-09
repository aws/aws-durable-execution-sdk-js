import { LocalDurableTestRunner} from "@amzn/durable-executions-type-script-testing-library";
import { handler } from '../promise-all';

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("promise-all test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });

    it("should complete all promises", async () => {
        const execution = await durableTestRunner.run();

        expect(execution.getOperations()).toHaveLength(4);
    })

    it("should return correct result - happy case", async () => {
        durableTestRunner.getOperationByIndex(0).mockResolvedValue(1);
        durableTestRunner.getOperationByIndex(1).mockResolvedValue(2);
        durableTestRunner.getOperationByIndex(2).mockResolvedValue(3);

        const execution = await durableTestRunner.run();

        expect(execution.getResult()).toStrictEqual([1, 2, 3]);
    });

    // TODO: enable following test once SDK/testing lib is fixed to handle concurrent retries
    // it("should fail if a promise fails - failure case", async () => {
    //     durableTestRunner.getOperationByIndex(0).mockRejectedValue(new Error("ERROR"));
    //
    //     const execution = await durableTestRunner.run();
    //
    //     expect(execution.getError()).toBeDefined();
    // });
});