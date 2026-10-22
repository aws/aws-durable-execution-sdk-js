import {
  withDurableExecution,
  type DurableInstrumentationPluginFactory,
} from "@aws/durable-execution-sdk-js";
import { LocalDurableTestRunner } from "../../local-durable-test-runner";

beforeAll(() =>
  LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
);
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it("checkpoints completed descendants before a minSuccessful map and skips them on replay through three wrappers", async () => {
  const winner = jest.fn(async () => "winner");
  const later = jest.fn(async () => "later");
  const calls = Array.from({ length: 3 }, () => ({
    invocation: 0,
    child: 0,
    attempt: 0,
  }));
  const plugins: DurableInstrumentationPluginFactory[] = calls.map((count) => ({
    createPlugin: () => ({
      wrapInvocation(_info, next) {
        count.invocation++;
        return next();
      },
      wrapChildContextFn(_info, next) {
        count.child++;
        return next();
      },
      wrapOperationAttemptFn(_info, next) {
        count.attempt++;
        return next();
      },
    }),
  }));
  const handler = withDurableExecution(
    async (_event, context) => {
      const values = await context.map(
        "early-map",
        [0, 1],
        async (child, item) => {
          if (item === 0) return child.step("winner", winner);
          await child.wait("held-branch", { seconds: 30 });
          return child.step("later", later);
        },
        {
          maxConcurrency: 2,
          completionConfig: { minSuccessful: 1 },
          itemNamer: (item) =>
            item === 0 ? "winner-branch" : "waiting-branch",
        },
      );
      await context.wait("resume-after-map", { seconds: 60 });
      return {
        values: values.getResults(),
        successCount: values.successCount,
        reason: values.completionReason,
      };
    },
    { plugins },
  );
  const runner = new LocalDurableTestRunner({ handlerFunction: handler });
  const execution = await runner.run();
  expect(execution.getStatus()).toBe("SUCCEEDED");
  expect(execution.getResult()).toEqual({
    values: ["winner"],
    successCount: 1,
    reason: "MIN_SUCCESSFUL_REACHED",
  });
  expect(execution.getInvocations().length).toBeGreaterThan(1);
  expect(winner).toHaveBeenCalledTimes(1);
  expect(later).not.toHaveBeenCalled();
  expect(calls[0].invocation).toBeGreaterThan(1);
  expect(calls[0].child).toBeGreaterThan(0);
  expect(calls[0].attempt).toBeGreaterThan(0);
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[2]).toEqual(calls[0]);
  const history = execution.getHistoryEvents();
  const end = (name: string, type: string) => {
    const id = runner.getOperation(name).getId();
    const events = history.filter(
      (event) => event.Id === id && event.EventType === type,
    );
    expect(events).toHaveLength(1);
    expect(events[0].EventId).toBeDefined();
    return events[0].EventId!;
  };
  const stepEnd = end("winner", "StepSucceeded");
  const branchEnd = end("winner-branch", "ContextSucceeded");
  const mapEnd = end("early-map", "ContextSucceeded");
  expect(stepEnd).toBeLessThan(branchEnd);
  expect(branchEnd).toBeLessThan(mapEnd);
});
