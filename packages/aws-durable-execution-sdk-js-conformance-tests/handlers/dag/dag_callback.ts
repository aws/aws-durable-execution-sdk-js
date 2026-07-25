// 10-11: DAG with an in-graph callback task (suspends until an external
// callback completes it). pre (step) -> cb (callback) -> post (step).
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

// The default callback deserializer returns the RAW payload text, so in JS the
// callback result includes its surrounding double-quote characters (e.g. the
// runner's alphanumeric payload `abc123` resolves to `"abc123"`). Strip a
// single surrounding pair of double quotes if present so the scenario asserts
// end-to-end payload identity rather than per-language deserializer encoding.
const normalizeCallbackResult = (value: string): string =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const result = await context.dag(
      "callbackdag",
      (d) => {
        // Root step.
        const pre = d.step("pre", [], async (): Promise<string> => "ready");

        // DAG task whose native op is a waitForCallback. The submitter receives
        // the generated callback id and does nothing durable; the conformance
        // runner completes the callback externally with a success payload.
        const cb = d.callback<"cb", [typeof pre], string>(
          "cb",
          [pre],
          async () => {
            // Submitter: nothing durable (same as the 7-1 handler).
          },
        );

        // Downstream step: normalize the callback payload (strip a single pair
        // of surrounding double quotes if present) then append "_done".
        d.step(
          "post",
          [cb],
          async (deps): Promise<string> =>
            `${normalizeCallbackResult(deps.cb)}_done`,
        );
      },
      { maxConcurrency: 1 },
    );

    return {
      reason: result.completionReason,
      statuses: {
        pre: result.getStatus("pre"),
        cb: result.getStatus("cb"),
        post: result.getStatus("post"),
      },
      counts: [
        result.successCount,
        result.failureCount,
        result.skippedCount,
        result.totalCount,
      ],
      cb: normalizeCallbackResult(result.getResult("cb") as string),
      post: result.getResult("post"),
    };
  },
);
