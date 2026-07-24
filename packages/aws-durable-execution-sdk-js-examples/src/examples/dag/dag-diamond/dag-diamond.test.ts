import { handler } from "./dag-diamond";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should fan out and fan in a diamond DAG with typed deps", async () => {
      const execution = await runner.run();

      expect(execution.getStatus()).toBe("SUCCEEDED");
      expect(execution.getResult()).toEqual({
        // fetch=10 -> a=11, b=12 -> merge=23
        merge: 23,
        completionReason: "ALL_COMPLETED",
        successCount: 4,
        totalCount: 4,
      });

      assertEventSignatures(execution);
    });
  },
});
