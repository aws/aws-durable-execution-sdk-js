import { handler } from "./logger-after-callback";
import { createTests } from "../../../utils/test-helper";
import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, isCloud) => {
    if (!isCloud) {
      it("should log correctly with modeAware=true", async () => {
        const logFilePath = path.join(
          os.tmpdir(),
          `logger-test-${randomUUID()}.log`,
        );

        if (fs.existsSync(logFilePath)) {
          fs.unlinkSync(logFilePath);
        }

        try {
          const executionPromise = runner.run({
            payload: { logFilePath, modeAware: true },
          });

          const callbackOp = runner.getOperationByIndex(0);
          await callbackOp.waitForData(WaitingOperationStatus.STARTED);
          await callbackOp.sendCallbackSuccess("test-result");

          const execution = await executionPromise;

          const result = execution.getResult() as any;
          expect(result.message).toBe("Success");
          expect(result.callbackId).toBeDefined();
          expect(result.result).toBe("test-result");

          const logContent = fs.readFileSync(logFilePath, "utf-8");
          const logLines = logContent
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));

          const beforeCallbackLogs = logLines.filter(
            (log) => log.message === "Before createCallback",
          );
          const afterCallbackLogs = logLines.filter(
            (log) => log.message === "After createCallback",
          );

          // With modeAware: true:
          // - "Before createCallback" appears once (execution mode only, suppressed during replay)
          // - "After createCallback" appears once (after callback resolves, in execution mode)
          expect(beforeCallbackLogs.length).toBe(1);
          expect(afterCallbackLogs.length).toBe(1);
        } finally {
          if (fs.existsSync(logFilePath)) {
            fs.unlinkSync(logFilePath);
          }
        }
      });

      it("should log correctly with modeAware=false", async () => {
        const logFilePath = path.join(
          os.tmpdir(),
          `logger-test-${randomUUID()}.log`,
        );

        if (fs.existsSync(logFilePath)) {
          fs.unlinkSync(logFilePath);
        }

        try {
          const executionPromise = runner.run({
            payload: { logFilePath, modeAware: false },
          });

          const callbackOp = runner.getOperationByIndex(0);
          await callbackOp.waitForData(WaitingOperationStatus.STARTED);
          await callbackOp.sendCallbackSuccess("test-result");

          const execution = await executionPromise;

          const result = execution.getResult() as any;
          expect(result.message).toBe("Success");

          const logContent = fs.readFileSync(logFilePath, "utf-8");
          const logLines = logContent
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));

          const beforeCallbackLogs = logLines.filter(
            (log) => log.message === "Before createCallback",
          );
          const afterCallbackLogs = logLines.filter(
            (log) => log.message === "After createCallback",
          );

          // With modeAware: false:
          // - "Before createCallback" appears twice (execution + replay)
          // - "After createCallback" appears once (after callback resolves)
          expect(beforeCallbackLogs.length).toBe(2);
          expect(afterCallbackLogs.length).toBe(1);
        } finally {
          if (fs.existsSync(logFilePath)) {
            fs.unlinkSync(logFilePath);
          }
        }
      });
    }

    it("should execute successfully", async () => {
      const executionPromise = runner.run();

      const callbackOp = runner.getOperationByIndex(0);
      await callbackOp.waitForData(WaitingOperationStatus.STARTED);
      await callbackOp.sendCallbackSuccess("test-result");

      const execution = await executionPromise;
      const result = execution.getResult() as any;
      expect(result.message).toBe("Success");
    });
  },
});
