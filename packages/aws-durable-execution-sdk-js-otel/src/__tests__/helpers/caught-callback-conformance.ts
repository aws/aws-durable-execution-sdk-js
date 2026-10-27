import type { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import {
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  context,
  propagation,
  trace,
  SpanStatusCode,
} from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Each view runs in its own Jest module environment, like a deployed function. */
export function testCaughtCallbackConformance(
  view: "execution" | "invocation",
) {
  describe(`${view} view deployed case-25 handler`, () => {
    const exporter = new InMemorySpanExporter();
    let provider: NodeTracerProvider;
    let handler: DurableLambdaHandler;
    const previousMode = process.env.OTEL_PLUGIN_MODE;

    beforeAll(async () => {
      LocalDurableTestRunner.setupTestEnvironment();
      trace.disable();
      context.disable();
      propagation.disable();
      provider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      provider.register();
      process.env.OTEL_PLUGIN_MODE = view;
      // Load the actual handler after selecting the same environment as its template.
      handler = (
        await import(
          resolve(
            __dirname,
            "../../../../aws-durable-execution-sdk-js-conformance-tests-otel/handlers/otel_25_caught_callback_failure.ts",
          )
        )
      ).handler;
    });

    afterAll(async () => {
      await provider.shutdown();
      trace.disable();
      context.disable();
      propagation.disable();
      if (previousMode === undefined) delete process.env.OTEL_PLUGIN_MODE;
      else process.env.OTEL_PLUGIN_MODE = previousMode;
      await LocalDurableTestRunner.teardownTestEnvironment();
    });

    beforeEach(() => exporter.reset());

    it("catches failure, replays twice, and returns success without repeating terminal export", async () => {
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      const execution = runner.run({
        payload: { scenario: "caught-callback-failure-replay" },
      });
      const failed = runner.getOperation("otel-failed-callback");
      // Match the cloud driver's completed-invocation boundary before forcing
      // the local runner to suspend, rather than interrupting its submitter.
      await failed.waitForData(WaitingOperationStatus.SUBMITTED);
      await runner.pauseExecution();
      await failed.sendCallbackFailure();
      await runner.resumeExecution();

      const failedLeaves = () =>
        exporter
          .getFinishedSpans()
          .filter(
            (span) =>
              span.attributes["durable.operation.type"] === "CALLBACK" &&
              span.attributes["durable.operation.status"] === "FAILED",
          );
      for (const suffix of ["one", "two"]) {
        const barrier = runner.getOperation(
          `otel-failed-callback-barrier-${suffix}`,
        );
        await barrier.waitForData(WaitingOperationStatus.SUBMITTED);
        await runner.pauseExecution();
        expect(failedLeaves()).toHaveLength(1);
        expect(failedLeaves()[0].status.code).toBe(SpanStatusCode.ERROR);
        expect(failedLeaves()[0].events).toHaveLength(0);
        await barrier.sendCallbackSuccess(JSON.stringify(suffix));
        await runner.resumeExecution();
      }
      const result = await execution;
      expect(result.getStatus()).toBe("SUCCEEDED");
      expect(result.getResult()).toBe("caught/one/two");
      expect(result.getInvocations()).toHaveLength(4);
      expect(result.getInvocations().every((item) => !item.error)).toBe(true);
      expect(failed.getStatus()).toBe("FAILED");
      expect(failedLeaves()).toHaveLength(1);
      expect(failedLeaves()[0].events).toHaveLength(0);

      const history = result.getHistoryEvents();
      expect(
        history.filter((event) => event.EventType === "CallbackFailed"),
      ).toHaveLength(1);
      expect(
        history.filter((event) => event.EventType === "CallbackStarted"),
      ).toHaveLength(3);
      expect(
        history.filter((event) => event.EventType === "StepStarted"),
      ).toHaveLength(4);
      expect(
        history.filter((event) => event.EventType === "StepSucceeded"),
      ).toHaveLength(4);
      const spans = exporter.getFinishedSpans();
      for (const name of [
        "otel-failed-callback-submitter",
        "otel-failed-callback-observed",
        "otel-failed-callback-barrier-one-submitter",
        "otel-failed-callback-barrier-two-submitter",
      ]) {
        const attempts = spans.filter(
          (span) => span.name === `${name} attempt 1`,
        );
        expect(attempts).toHaveLength(1);
        expect(attempts[0].status.code).toBe(SpanStatusCode.OK);
        expect(attempts[0].attributes["durable.attempt.outcome"]).toBe(
          "SUCCEEDED",
        );
        const completed = spans.filter(
          (span) =>
            span.name === name &&
            span.attributes["durable.operation.status"] === "SUCCEEDED",
        );
        expect(completed).toHaveLength(1);
        expect(completed[0].status.code).toBe(SpanStatusCode.OK);
      }
      expect(spans.find((span) => span.name === "Workflow")?.status.code).toBe(
        SpanStatusCode.OK,
      );
      expect(
        spans
          .filter((span) => span.name === "Invocation")
          .map((span) => span.attributes["durable.invocation.status"]),
      ).toEqual(["PENDING", "PENDING", "PENDING", "SUCCEEDED"]);

      const artifactDirectory = process.env.OTEL_CONFORMANCE_TEST_ARTIFACTS;
      if (artifactDirectory) {
        writeFileSync(
          resolve(artifactDirectory, `case25-${view}.json`),
          JSON.stringify(
            {
              view,
              history,
              spans: spans.map((span) => ({
                name: span.name,
                context: span.spanContext(),
                parent: span.parentSpanContext,
                attributes: span.attributes,
                status: span.status,
                events: span.events,
                startTime: span.startTime,
                endTime: span.endTime,
                links: span.links,
              })),
            },
            null,
            2,
          ),
        );
      }
    }, 30000);

    it("rejects an unexpectedly successful first callback", async () => {
      const runner = new LocalDurableTestRunner({ handlerFunction: handler });
      const execution = runner.run({
        payload: { scenario: "caught-callback-failure-replay" },
      });
      const failed = runner.getOperation("otel-failed-callback");
      await failed.waitForData(WaitingOperationStatus.SUBMITTED);
      await failed.sendCallbackSuccess("unexpected");
      const result = await execution;
      expect(result.getStatus()).toBe("FAILED");
      expect(result.getError().errorMessage).toBe(
        "Expected the callback to fail",
      );
      expect(
        result
          .getOperations()
          .some(
            (operation) =>
              operation.getName() === "otel-failed-callback-observed",
          ),
      ).toBe(false);
    }, 30000);
  });
}
