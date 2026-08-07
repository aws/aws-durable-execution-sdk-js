import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { EventType } from "@aws-sdk/client-lambda";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

/**
 * The oversized-result path, end to end.
 *
 * When a handler's return value exceeds Lambda's response size limit the SDK
 * checkpoints it as an EXECUTION-typed SUCCEED update under a synthetic
 * `execution-result-<timestamp>` id, then returns `{ Status: SUCCEEDED,
 * Result: "" }`. The service applies that update to the execution itself,
 * ignoring the synthetic id, and ignores the invocation response because the
 * execution is already terminal.
 *
 * The shape asserted here is the one a real `GetDurableExecutionHistory` returns
 * for such an execution:
 *
 *     ExecutionStarted      Id: <executionId>
 *     StepStarted           Id: <stepId>
 *     StepSucceeded         Id: <stepId>
 *     InvocationCompleted   Id: None
 *     ExecutionSucceeded    Id: <executionId>
 *
 * Ordering is the one known remaining difference: the service emits
 * `InvocationCompleted` before the terminal event, the local runner after. That
 * is tracked with the event-ordering TODO in local-durable-test-runner.ts, so
 * these assertions are on counts and ids rather than positions.
 */
describe("oversized execution result", () => {
  const oversizedHandler = withDurableExecution(async (_, context) => {
    // Small enough to checkpoint inline as usual.
    await context.step("plan", () => Promise.resolve({ rows: 1 }));

    // Comfortably past the SDK's 6MB response-size guard.
    return "x".repeat(6 * 1024 * 1024 + 1000);
  });

  it("matches the history the service produces", async () => {
    const runner = new LocalDurableTestRunner({
      handlerFunction: oversizedHandler,
    });

    const execution = await runner.run({ payload: {} });
    const events = execution.getHistoryEvents();

    const executionId = events.find(
      (event) => event.EventType === EventType.ExecutionStarted,
    )?.Id;
    expect(typeof executionId).toBe("string");

    // One ExecutionStarted. Two would mean the history was assembled twice.
    expect(
      events.filter((event) => event.EventType === EventType.ExecutionStarted),
    ).toHaveLength(1);

    // One terminal event, keyed by the execution id rather than by the
    // checkpoint's synthetic `execution-result-*` id.
    const succeeded = events.filter(
      (event) => event.EventType === EventType.ExecutionSucceeded,
    );
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0].Id).toBe(executionId);

    // The terminal event carries the oversized payload, which is why it could
    // not be returned inline.
    const payload = succeeded[0].ExecutionSucceededDetails?.Result?.Payload;
    expect(typeof payload).toBe("string");
    expect(Buffer.byteLength(payload!, "utf8")).toBeGreaterThan(
      6 * 1024 * 1024 - 50,
    );

    // The invocation still completes. Suppressing the ignored response entirely
    // stalls it, leaving no InvocationCompleted event and no invocations.
    expect(
      events.filter(
        (event) => event.EventType === EventType.InvocationCompleted,
      ),
    ).toHaveLength(1);
    expect(execution.getInvocations()).toHaveLength(1);

    // The caller still receives the whole result.
    expect((execution.getResult() as string).length).toBe(
      6 * 1024 * 1024 + 1000,
    );
  }, 60000);

  it("keeps the ordinary inline path unchanged", async () => {
    const runner = new LocalDurableTestRunner({
      handlerFunction: withDurableExecution(async (_, context) => {
        await context.step("plan", () => Promise.resolve({ rows: 1 }));
        return "small";
      }),
    });

    const execution = await runner.run({ payload: {} });
    const events = execution.getHistoryEvents();

    expect(
      events.filter(
        (event) => event.EventType === EventType.ExecutionSucceeded,
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) => event.EventType === EventType.InvocationCompleted,
      ),
    ).toHaveLength(1);
    expect(execution.getInvocations()).toHaveLength(1);
    expect(execution.getResult()).toBe("small");
  }, 60000);
});
