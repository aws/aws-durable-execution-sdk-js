import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { createTests } from "../../../utils/test-helper";
import { handler } from "./invoke-simple";
import { handler as namedWaitHandler } from "../../wait/named/wait-named";
import { handler as handlerErrorHandler } from "../../handler-error/handler-error";
import { handler as nonDurableHandler } from "../../non-durable/non-durable";
import { handler as namedStepHandler } from "../../step/named/step-named";

createTests({
  name: "invoke-simple",
  functionName: "invoke-simple",
  handler,
  tests: function (runner, { functionNameMap }) {
    it("should run invoke with basic wait state", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(
          functionNameMap.getFunctionName("wait-named"),
          namedWaitHandler,
        );
      }

      const result = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName("wait-named"),
        },
      });
      expect(result.getResult()).toBe("wait finished");
    });

    it("should run invoke with step and payload", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(
          functionNameMap.getFunctionName("step-named"),
          namedStepHandler,
        );
      }

      const result = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName("step-named"),
          payload: {
            data: "data from parent",
          },
        },
      });
      expect(result.getResult()).toEqual("processed: data from parent");
    });

    it("should run invoke with child function failure", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerDurableFunction(
          functionNameMap.getFunctionName("handler-error"),
          handlerErrorHandler,
        );
      }

      const result = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName("handler-error"),
        },
      });
      expect(result.getError()).toEqual({
        errorMessage: "Intentional handler failure",
        errorType: "InvokeError",
      });
    });

    it("should run invoke with non-durable function success", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerFunction(
          functionNameMap.getFunctionName("non-durable"),
          nonDurableHandler,
        );
      }

      const result = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName("non-durable"),
        },
      });
      expect(result.getResult()).toEqual({
        status: 200,
        body: JSON.stringify({
          message: "Hello from Lambda!",
        }),
      });
    });

    it("should run invoke with non-durable function failure", async () => {
      if (runner instanceof LocalDurableTestRunner) {
        runner.registerFunction(
          functionNameMap.getFunctionName("non-durable"),
          nonDurableHandler,
        );
      }

      const result = await runner.run({
        payload: {
          functionName: functionNameMap.getFunctionName("non-durable"),
          payload: {
            failure: true,
          },
        },
      });
      expect(result.getError()).toEqual({
        errorMessage: "This is a failure",
        errorType: "InvokeError",
      });
    });
  },
});
