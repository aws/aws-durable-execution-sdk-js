import {
    LocalDurableTestRunner,
    WaitingOperationStatus
} from "@amzn/durable-executions-type-script-testing-library";
import {handler} from '../create-callback';

let durableTestRunner: LocalDurableTestRunner<string>;

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

beforeEach(() => {
    durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });
})

describe("create-callback test", () => {
    it("function completes when callback succeeds - happy case", async () => {
        const res = "successful";
        const executionPromise = durableTestRunner.run();

        const callbackOp = durableTestRunner.getOperationByIndex(0);
        await callbackOp.waitForData(WaitingOperationStatus.STARTED);
        await callbackOp.sendCallbackSuccess(res);

        const execution = await executionPromise;

        expect(callbackOp.getCallbackDetails()?.result).toStrictEqual(res)
        expect(execution.getResult()).toStrictEqual(res);
    });

    it("function completes when callback fails - happy case", async () => {
        const executionPromise = durableTestRunner.run();

        const callbackOp = durableTestRunner.getOperationByIndex(0);
        await callbackOp.waitForData(WaitingOperationStatus.STARTED);
        await callbackOp.sendCallbackFailure({ErrorMessage: "ERROR"});

        const execution = await executionPromise;

        expect(callbackOp.getCallbackDetails()?.error).toBeDefined()
        expect(execution.getError()).toBeDefined();
    });

    it("function times out when callback is not called - failure case", async () => {
        // TODO: add test when callback timeout is handled in TS SDK: https://tiny.amazon.com/1f5679y8l
    });
});