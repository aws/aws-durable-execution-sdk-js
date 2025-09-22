import { LocalDurableTestRunner} from "aws-durable-execution-sdk-js-testing";
import { handler } from '../step-with-retry';

const EXPECTED_RESULT = "step succeeded";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("step-with-retry test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });

    it("should return expected result - happy case", async () => {
        jest.spyOn(Math, "random").mockReturnValue(1);
        const execution = await durableTestRunner.run();

        expect(execution.getResult()).toStrictEqual(EXPECTED_RESULT);

        // verify that durable step was executed
        const stepOp = durableTestRunner.getOperationByIndex(0);
        expect(stepOp.getStepDetails()?.result).toBeDefined();
    });

    it("should execute the step upon retry - happy case", async () => {
        jest.spyOn(Math, "random")
            .mockReturnValue(0.1)
            .mockReturnValue(1);
        const execution = await durableTestRunner.run();

        expect(execution.getResult()).toStrictEqual(EXPECTED_RESULT);

        // verify durable step was executed only once
        const stepOp = durableTestRunner.getOperationByIndex(0);
        expect(stepOp.getStepDetails()?.result).toBeDefined();
    });

    it("should retry until all attempts fail - failure case", async () => {
        jest.spyOn(Math, "random").mockReturnValue(0.1);
        const execution = await durableTestRunner.run();

        expect(execution.getError()).toBeDefined();

        // verify durable step completed with an error
        const stepOp = durableTestRunner.getOperationByIndex(0);
        expect(stepOp.getStepDetails()?.error).toBeDefined();
    });
});