import { handler } from "./logger-after-wait";
import historyEvents from "./logger-after-wait.history.json";
import { createTests } from "../../../utils/test-helper";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

createTests({
  name: "logger-after-wait",
  functionName: "logger-after-wait",
  handler,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    if (!isCloud) {
      it("should log after wait in execution mode with modeAware=true", async () => {
        const logFilePath = path.join(
          os.tmpdir(),
          `logger-test-${randomUUID()}.log`,
        );

        if (fs.existsSync(logFilePath)) {
          fs.unlinkSync(logFilePath);
        }

        try {
          const execution = await runner.run({
            payload: { logFilePath, modeAware: true },
          });

          expect(execution.getResult()).toEqual({ message: "Success" });

          const logContent = fs.readFileSync(logFilePath, "utf-8");
          const logLines = logContent
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));

          const beforeWaitLogs = logLines.filter(
            (log) => log.message === "Before wait",
          );
          const afterWaitLogs = logLines.filter(
            (log) => log.message === "After wait",
          );

          // With modeAware: true, both logs appear once (execution mode only)
          expect(beforeWaitLogs.length).toBe(1);
          expect(afterWaitLogs.length).toBe(1);

          assertEventSignatures(execution.getHistoryEvents(), historyEvents);
        } finally {
          if (fs.existsSync(logFilePath)) {
            fs.unlinkSync(logFilePath);
          }
        }
      });
    }

    it("should execute successfully", async () => {
      const execution = await runner.run();
      expect(execution.getResult()).toEqual({ message: "Success" });

      assertEventSignatures(execution.getHistoryEvents(), historyEvents);
    });
  },
});
