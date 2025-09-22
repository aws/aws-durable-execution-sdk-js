import { LocalDurableTestRunner} from "aws-durable-execution-sdk-js-testing";
import { handler } from '../step-named';

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("step-named test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });

    const DEFAULT = "default";

    const getExpectedResult = (input: any) => `processed: ${input}`;

    it("should return default data if no input", async () => {
       const execution = await durableTestRunner.run();

       expect(execution.getResult())
           .toStrictEqual(getExpectedResult(DEFAULT));
    });

    it("should return provided input", async () => {
        const INPUT = {
            "data": {
                "foo": "bar"
            }
        };

        const execution = await durableTestRunner.run({
            payload: INPUT,
        });

        expect(execution.getResult())
            .toStrictEqual(getExpectedResult(INPUT.data));
    });

    it("named step should return correct result", async () => {
        const execution = await durableTestRunner.run();

        expect(durableTestRunner.getOperation("process-data").getStepDetails()?.result)
            .toStrictEqual(getExpectedResult(DEFAULT));
    })
});