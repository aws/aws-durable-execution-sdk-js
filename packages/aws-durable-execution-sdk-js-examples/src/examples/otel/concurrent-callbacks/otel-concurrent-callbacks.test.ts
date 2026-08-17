import {
  InvocationType,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import {
  handler,
  resetExporter,
  getSerializedSpans,
} from "./otel-concurrent-callbacks";
import { createTests } from "../../../utils/test-helper";
import { SerializedSpan } from "../shared/otel-test-setup";

createTests({
  handler,
  invocationType: InvocationType.Event,
  tests: (runner, { assertEventSignatures, isCloud }) => {
    beforeEach(() => {
      resetExporter();
    });

    it("does not leak a waitForCallback's derived name onto a concurrent step", async () => {
      const cb = runner.getOperation("cb");
      const executionPromise = runner.run();

      await cb.waitForData(WaitingOperationStatus.SUBMITTED);
      await cb.sendCallbackSuccess("cb-value");

      const execution = await executionPromise;
      const result = execution.getResult() as {
        callbackResult: string;
        plain: string;
        spans: SerializedSpan[];
      };

      expect(result.callbackResult).toBe("cb-value");
      expect(result.plain).toBe("plain-value");

      if (!isCloud) {
        const spans = getSerializedSpans();
        const parentNameOf = (s: SerializedSpan) =>
          spans.find((p) => p.spanId === s.parentSpanId)?.attributes[
            "durable.operation.name"
          ];

        // The waitForCallback's inner CALLBACK carries its derived name and
        // parents to the "cb" CONTEXT.
        const callbackSpan = spans.find(
          (s) => s.attributes["durable.operation.type"] === "CALLBACK",
        );
        expect(callbackSpan).toBeDefined();
        expect(callbackSpan!.attributes["durable.operation.name"]).toBe(
          "cb-callback",
        );
        expect(parentNameOf(callbackSpan!)).toBe("cb");

        // The submitter STEP likewise gets "cb-submitter" under the CONTEXT.
        const submitterOp = spans.find(
          (s) =>
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.operation.name"] === "cb-submitter" &&
            s.attributes["durable.attempt.outcome"] === undefined,
        );
        expect(submitterOp).toBeDefined();
        expect(parentNameOf(submitterOp!)).toBe("cb");

        // The concurrent plain step keeps its OWN name — it never inherits the
        // callback's derived name, and it does not parent to the CONTEXT.
        const plainOp = spans.find(
          (s) =>
            s.attributes["durable.operation.type"] === "STEP" &&
            s.attributes["durable.operation.name"] === "plain-step" &&
            s.attributes["durable.attempt.outcome"] === undefined,
        );
        expect(plainOp).toBeDefined();
        expect(parentNameOf(plainOp!)).not.toBe("cb");

        // No span carries a callback-derived name it should not: the only spans
        // named with a callback suffix are the CALLBACK and submitter above.
        const derivedNamed = spans.filter((s) => {
          const n = s.attributes["durable.operation.name"] as
            | string
            | undefined;
          return n === "cb-callback" || n === "cb-submitter";
        });
        for (const s of derivedNamed) {
          const type = s.attributes["durable.operation.type"];
          // Only CALLBACK / STEP (submitter) + their attempt spans may carry
          // these names — never the plain step.
          expect(["CALLBACK", "STEP"]).toContain(type);
        }
      }

      assertEventSignatures(execution);
    }, 60000);
  },
});
