// startHeartbeats throws only on a defect, so this file replaces it with a
// mock that throws. The other worker tests use the real function.
import { describe, expect, it, vi } from "vitest";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import { startAgentcoreWorker } from "..";

vi.mock("../../microvm/worker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../microvm/worker")>()),
  startHeartbeats: () => {
    throw new Error("timer setup failed");
  },
}));

describe("startAgentcoreWorker when heartbeats cannot start", () => {
  it("fails the callback, does not run the handler, and keeps serving", async () => {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const client = {
      send: async (command: {
        constructor: { name: string };
        input: Record<string, unknown>;
      }) => {
        calls.push({ name: command.constructor.name, input: command.input });
        return {};
      },
      destroy: () => {},
    } as unknown as LambdaClient;
    const errors: string[] = [];
    let runs = 0;
    const worker = await startAgentcoreWorker(
      {
        handler: async () => {
          runs++;
        },
        createClient: () => client,
        logger: {
          info: () => {},
          warn: () => {},
          error: (message) => errors.push(message),
        },
      },
      0,
      "127.0.0.1",
    );
    try {
      const response = await fetch(
        `http://127.0.0.1:${worker.port}/invocations`,
        {
          method: "POST",
          body: JSON.stringify({
            version: 1,
            region: "us-east-1",
            callbackId: "cb-1",
            heartbeatTimeoutSeconds: 60,
            input: {},
          }),
        },
      );
      await worker.idle();
      const ping = await fetch(`http://127.0.0.1:${worker.port}/ping`);

      expect(await response.json()).toEqual({ accepted: true });
      expect(runs).toBe(0);
      expect(calls).toEqual([
        {
          name: "SendDurableExecutionCallbackFailureCommand",
          input: {
            CallbackId: "cb-1",
            Error: { ErrorType: "Error", ErrorMessage: "timer setup failed" },
          },
        },
      ]);
      expect(errors).toEqual(["could not start heartbeats for the job"]);
      expect(ping.status).toBe(200);
      await ping.body?.cancel();
    } finally {
      await worker.close();
    }
  });
});
