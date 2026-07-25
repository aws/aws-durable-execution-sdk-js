// 10-10: DAG with an in-graph invoke task (suspends and resumes across
// invocations). prep (step) -> call (invoke) -> done (step).
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const targetFunctionName: string = process.env.TARGET_FUNCTION_NAME!;

    const result = await context.dag(
      "invokedag",
      (d) => {
        // Root step producing the payload value.
        const prep = d.step("prep", [], async (): Promise<number> => 21);

        // DAG task whose native op is an invoke of the echo target. The payload
        // is prep's resolved value (21); the echo target returns it unchanged,
        // so `call` resolves to the integer 21.
        const call = d.invoke<"call", [typeof prep], number, number>(
          "call",
          targetFunctionName,
          [prep],
          (deps) => deps.prep,
        );

        // Downstream step depending on the invoke result.
        d.step("done", [call], async (deps): Promise<number> => deps.call * 2);
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        prep: result.getStatus("prep"),
        call: result.getStatus("call"),
        done: result.getStatus("done"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      call: result.getResult("call"),
      done: result.getResult("done"),
    };
  },
);
