import {LocalDurableTestRunner, WaitingOperationStatus} from "aws-durable-execution-sdk-js-testing";
import {handler} from '../wait-for-callback';

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

let durableTestRunner: LocalDurableTestRunner<void>;

beforeEach(async () => {
    durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });
})

describe("wait-for-callback test", () => {
    it("function completes when callback succeeds - happy case", async () => {
        const executionPromise = durableTestRunner.run();

        const waitForCallbackOp = durableTestRunner.getOperationByIndex(0);
        await waitForCallbackOp.waitForData(WaitingOperationStatus.STARTED)
        await waitForCallbackOp.sendCallbackSuccess("succeeded");

        const execution = await executionPromise;

        expect(execution.getResult()).toBeDefined()
    });

    it("function completes when callback fails - happy case", async () => {
        const executionPromise = durableTestRunner.run();

        const waitForCallbackOp = durableTestRunner.getOperationByIndex(0);
        await waitForCallbackOp.waitForData(WaitingOperationStatus.STARTED)
        await waitForCallbackOp.sendCallbackFailure({ErrorMessage: "ERROR"});

        const execution = await executionPromise;

        expect(execution.getError()).toBeDefined()
    });

    it("function times out when callback is not called - failure case", async () => {
        // TODO: add test when callback timeout is handled in TS SDK: https://tiny.amazon.com/1f5679y8l
    });
});