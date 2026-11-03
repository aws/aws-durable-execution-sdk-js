// Runs the operations against real services, inside the local test runner.
// It is skipped unless AI_LIVE=1, because it needs:
//
// 1. A Strands Decider server. Set STRANDS_DECIDER_ENDPOINT to its
//    `POST /v1/systemone` URL, such as http://127.0.0.1:8000/v1/systemone.
// 2. AWS credentials that can call bedrock:InvokeModel on
//    global.anthropic.claude-haiku-5-5, and AWS_REGION.
//
// Usage: AI_LIVE=1 STRANDS_DECIDER_ENDPOINT=... npx jest src/ai/__tests__/live.test.ts
import {
  type DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { decider, llm } from "..";

const BODY =
  "Help! My payouts have been failing for 3 days and nobody answers.";

const live = process.env.AI_LIVE === "1" ? describe : describe.skip;

live("decider and llm against live services", () => {
  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  it("answers four operations with the decision model and ask with Bedrock", async () => {
    const decide = decider();
    const model = llm();
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
            decide.check(context, "Does the writer sound urgent?", BODY),
          ),
          team: await timed("classify", () =>
            decide.classify(
              context,
              "Which team should handle this?",
              ["billing", "sales", "retail"],
              BODY,
            ),
          ),
          topics: await timed("label", () =>
            decide.label(
              context,
              "Which topics does the message mention?",
              ["payments", "shipping", "pricing", "security"],
              BODY,
            ),
          ),
          frustration: await timed("score", () =>
            decide.score(
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

    expect(result.getStatus()).toBe("SUCCEEDED");
    const value = result.getResult() as Record<string, unknown>;
    expect(value.urgent).toBe(true);
    expect(value.team).toBe("billing");
    expect(value.topics).toContain("payments");
    expect(value.frustration).toBeGreaterThanOrEqual(0);
    expect(value.frustration).toBeLessThanOrEqual(1);
    expect(typeof value.summary).toBe("string");
    expect((value.summary as string).length).toBeGreaterThan(0);
    expect(
      result.getOperations().map((operation) => operation.getSubType()),
    ).toEqual([
      "DeciderCheck",
      "DeciderClassify",
      "DeciderLabel",
      "DeciderScore",
      "LlmAsk",
    ]);
  }, 120_000);
});
