import { handler } from "./plugin-hook-errors";
import { createTests } from "../../utils/test-helper";
import {
  ExecutionStatus,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("completes successfully even though every plugin hook throws", async () => {
      const execution = await runner.run();

      // A buggy plugin must not change the execution outcome.
      expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);

      const result = execution.getResult() as {
        greeting: string;
        childResult: string;
        recovered: boolean;
      };
      expect(result.greeting).toBe("hello");
      expect(result.childResult).toBe("child-done");
      // The failing step's error still surfaced (re-thrown through the plugin
      // wrappers) and was recovered from inside the workflow.
      expect(result.recovered).toBe(true);

      // The wrapped operations ran normally despite the throwing wrap hooks.
      expect(runner.getOperation("greet").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );
      expect(runner.getOperation("child").getStatus()).toBe(
        OperationStatus.SUCCEEDED,
      );
      expect(runner.getOperation("failing-step").getStatus()).toBe(
        OperationStatus.FAILED,
      );

      assertEventSignatures(execution);
    });
  },
});
