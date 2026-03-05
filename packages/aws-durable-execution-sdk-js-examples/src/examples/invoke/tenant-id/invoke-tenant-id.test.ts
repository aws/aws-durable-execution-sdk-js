import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./invoke-tenant-id";
import { handler as namedWaitHandler } from "../../wait/named/wait-named";

createTests({
  handler,
  tests: function (runner, { functionNameMap, assertEventSignatures }) {
    it("should invoke with tenantId for tenant isolation", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(
          functionNameMap.getFunctionName("wait-named"),
          namedWaitHandler,
        );
      }

      const result = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName("wait-named"),
          tenantId: "tenant-abc-123",
        },
      });
      expect(result.getResult()).toBe("wait finished");

      assertEventSignatures(result, "tenant-id");
    });
  },
});
