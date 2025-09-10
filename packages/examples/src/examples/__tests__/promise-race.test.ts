import {LocalDurableTestRunner, OperationStatus} from "@amzn/durable-executions-type-script-testing-library";
import { handler } from '../promise-race';

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("promise-race test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });

    it("should complete all promises", async() => {
        await durableTestRunner.run();

        // we can't expect all promises to complete here as promise race will resolve
        // as soon as one of the promises resolves
        const promiseRaceOp = durableTestRunner.getOperation("promise-race");
        expect(promiseRaceOp.getStatus()).toStrictEqual(OperationStatus.SUCCEEDED);
        expect(promiseRaceOp.getStepDetails()?.result).toBeDefined();
    });

    it("should return expected result", async () => {
        const execution = await durableTestRunner.run();

        expect(execution.getResult()).toStrictEqual("fast result");
    });

    // TODO: enable following test once SDK/testing lib is fixed to handle concurrent retries
    // it("should fail if a promise fails - failure case", async () => {
    //     // reject the fastest promise
    //     durableTestRunner.getOperationByIndex(1).mockRejectedValue(new Error("ERROR"));
    //
    //     const execution = await durableTestRunner.run();
    //
    //     expect(execution.getError()).toBeDefined();
    // });
});