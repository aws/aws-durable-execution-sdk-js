import { LocalDurableTestRunner} from "aws-durable-execution-sdk-js-testing";
import { handler } from "../map-basic";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("map-basic test", () => {
   const durableTestRunner = new LocalDurableTestRunner({
       handlerFunction: handler,
       skipTime: true,
   });

   it("should run correct number of durable steps", async () => {
      const execution = await durableTestRunner.run();

      expect(durableTestRunner.getOperation("map").getChildOperations()).toHaveLength(5);
   });

   it("should return correct result", async () => {
      const execution = await durableTestRunner.run();

      const result = execution.getResult()

      expect(result).toStrictEqual([1, 2, 3, 4, 5].map(e => e * 2));
   });
});