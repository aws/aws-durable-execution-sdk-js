import {
  LocalDurableTestRunner,
  OperationStatus,
} from "aws-durable-execution-sdk-js-testing";
import { handler } from "../promise-race";
import { createTests } from "./shared/test-helper";

createTests({
  name: "promise-race test",
  functionName: "promise-race",
  handler,
  tests: (runner) => {
    it("should complete all promises", async () => {
      await runner.run();

      // we can't expect all promises to complete here as promise race will resolve
      // as soon as one of the promises resolves
      const promiseRaceOp = runner.getOperation("promise-race");
      expect(promiseRaceOp.getStatus()).toStrictEqual(
        OperationStatus.SUCCEEDED
      );
      expect(promiseRaceOp.getStepDetails()?.result).toBeDefined();
    });

    it("should return expected result", async () => {
      const execution = await runner.run();

      expect(execution.getResult()).toStrictEqual("fast result");
    });
  },
});
