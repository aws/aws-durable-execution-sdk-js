import { handler } from "./child-operations-preservation";
import { createTests } from "../../utils/test-helper";
import {
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

createTests({
  handler,
  localRunnerConfig: {
    skipTime: true,
  },
  tests: (runner, { assertEventSignatures }) => {
    it("preserves the children of a FAILED context across resume", async () => {
      const execution = await runner.run();

      // The execution succeeds; only the inner context failed.
      expect(execution.getResult()).toEqual({ branchFailed: true });

      const branch = runner.getOperation("failing-branch");
      expect(branch.getType()).toBe(OperationType.CONTEXT);
      expect(branch.getStatus()).toBe(OperationStatus.FAILED);

      // The assertion that matters: after the wait/resume the FAILED context
      // still carries its children. Locally this always holds; in the cloud
      // integration run it fails if the backend prunes children of failed
      // contexts despite ReplayChildren (childOperationsDepth) — which is
      // exactly the behavior we want to catch.
      const children = branch.getChildOperations() ?? [];
      const childNames = children.map((c) => c.getName());
      expect(childNames).toContain("child-step-ok");
      expect(childNames).toContain("child-step-boom");

      assertEventSignatures(execution);
    });
  },
});
