// Runs the five operations against real services, inside the local test
// runner. It is skipped unless LLM_LIVE=1, because it needs:
//
// 1. A Strands Decider server. Set STRANDS_DECIDER_ENDPOINT to its
//    `POST /v1/systemone` URL, such as http://127.0.0.1:8000/v1/systemone.
// 2. AWS credentials that can call bedrock:InvokeModel on
//    global.anthropic.claude-haiku-5-5, and AWS_REGION.
//
// Usage: LLM_LIVE=1 STRANDS_DECIDER_ENDPOINT=... npx jest src/llm/__tests__/live.test.ts
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { llm } from "..";

const BODY =
  "Help! My payouts have been failing for 3 days and nobody answers.";

const live = process.env.LLM_LIVE === "1" ? describe : describe.skip;

live("llm against live services", () => {
  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  async function runAll(model: ReturnType<typeof llm>) {
    const timings: Record<string, number> = {};
    const timed = async <T>(name: string, call: () => Promise<T>) => {
      const start = Date.now();
      try {
        return await call();
      } finally {
        timings[name] = Date.now() - start;
      }
    };
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(
        async (_event: unknown, context: DurableContext) => ({
          urgent: await timed("check", () =>
            model.check(context, "Does the writer sound urgent?", BODY),
          ),
          team: await timed("classify", () =>
            model.classify(
              context,
              "Which team should handle this?",
              ["billing", "sales", "retail"],
              BODY,
            ),
          ),
          topics: await timed("label", () =>
            model.label(
              context,
              "Which topics does the message mention?",
              ["payments", "shipping", "pricing", "security"],
              BODY,
            ),
          ),
          frustration: await timed("score", () =>
            model.score(
              context,
              "How frustrated is the writer?",
              ["calm", "annoyed", "furious"],
              BODY,
            ),
          ),
          summary: await timed("ask", () =>
            model.ask(
              context,
              "Summarize the message in one short sentence.",
              BODY,
            ),
          ),
        }),
      ),
    });
    const result = await runner.run({ payload: {} });
    console.log(
      JSON.stringify(
        { status: result.getStatus(), result: result.getResult(), timings },
        null,
        2,
      ),
    );
    return result;
  }

  it("answers four operations with the decision model and ask with Bedrock", async () => {
    const result = await runAll(llm());

    expect(result.getStatus()).toBe("SUCCEEDED");
    const value = result.getResult() as Record<string, unknown>;
    expect(value.urgent).toBe(true);
    expect(value.team).toBe("billing");
    expect(value.topics).toContain("payments");
    expect(value.frustration).toBeGreaterThanOrEqual(0);
    expect(value.frustration).toBeLessThanOrEqual(1);
    expect(typeof value.summary).toBe("string");
    expect((value.summary as string).length).toBeGreaterThan(0);
  }, 120_000);

  it("rejects the decision operations, and still answers ask, without a decision model", async () => {
    const saved = process.env.STRANDS_DECIDER_ENDPOINT;
    delete process.env.STRANDS_DECIDER_ENDPOINT;
    try {
      const model = llm();
      const runner = new LocalDurableTestRunner({
        handlerFunction: withDurableExecution(
          async (_event: unknown, context: DurableContext) => {
            const rejected = await model
              .check(context, "Is it urgent?", BODY)
              .then(
                () => "resolved",
                (error: unknown) => (error as Error).name,
              );
            const summary = await model.ask(
              context,
              "Summarize the message in one short sentence.",
              BODY,
            );
            return { rejected, summary };
          },
        ),
      });
      const result = await runner.run({ payload: {} });

      expect(result.getStatus()).toBe("SUCCEEDED");
      const value = result.getResult() as { rejected: string; summary: string };
      expect(value.rejected).toBe("TypeError");
      expect(value.summary.length).toBeGreaterThan(0);
    } finally {
      if (saved !== undefined) {
        process.env.STRANDS_DECIDER_ENDPOINT = saved;
      }
    }
  }, 120_000);
});
