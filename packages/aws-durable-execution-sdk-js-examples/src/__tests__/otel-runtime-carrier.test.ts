import { deriveExecutionTraceId } from "@aws/durable-execution-sdk-js-otel";
import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import {
  handler,
  type CarrierObservation,
} from "../examples/otel/runtime-carrier/otel-runtime-carrier";

describe("runtime carrier example", () => {
  const environmentHeader =
    "Root=1-aaaaaaaa-aaaaaaaaaaaaaaaaaaaaaaaa;Parent=aaaaaaaaaaaaaaaa;Sampled=1";
  const localHeader =
    "Root=1-bbbbbbbb-bbbbbbbbbbbbbbbbbbbbbbbb;Parent=bbbbbbbbbbbbbbbb;Sampled=1";
  let previousHeader: string | undefined;

  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: false }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());
  beforeEach(() => {
    previousHeader = process.env._X_AMZN_TRACE_ID;
    process.env._X_AMZN_TRACE_ID = environmentHeader;
  });
  afterEach(() => {
    if (previousHeader === undefined) delete process.env._X_AMZN_TRACE_ID;
    else process.env._X_AMZN_TRACE_ID = previousHeader;
  });

  it.each(["absent", "undefined", "null", "empty", "explicit"])(
    "keeps helper and extractor consistent for an %s runtime carrier across resume",
    async (availability) => {
      const expectedFallbacks: string[] = [];
      const runner = new LocalDurableTestRunner<{
        first: CarrierObservation;
        resumed: CarrierObservation;
      }>({
        handlerFunction: (event, context) => {
          if (availability !== "absent") {
            Object.defineProperty(context, "xRayTraceId", {
              value:
                availability === "undefined"
                  ? undefined
                  : availability === "null"
                    ? null
                    : availability === "empty"
                      ? ""
                      : localHeader,
            });
          }
          const start = event.InitialExecutionState.Operations?.find(
            (operation) => operation.Type === "EXECUTION",
          )?.StartTimestamp;
          expectedFallbacks.push(
            deriveExecutionTraceId(
              {},
              event.DurableExecutionArn,
              start === undefined ? undefined : new Date(start),
            ),
          );
          return handler(event, context);
        },
      });
      const result = await runner.run();
      expect(result.getStatus()).toBe("SUCCEEDED");
      const captured = result.getResult();
      expect(captured).toBeDefined();
      if (!captured) throw new Error("Carrier observations are missing");
      expect(expectedFallbacks.length).toBeGreaterThanOrEqual(2);
      for (const observation of [captured.first, captured.resumed]) {
        if (availability === "absent" || availability === "explicit") {
          const expectedTraceId = (
            availability === "absent" ? "a" : "b"
          ).repeat(32);
          expect(observation.extracted?.traceId).toBe(expectedTraceId);
          expect(observation.traceId).toBe(expectedTraceId);
          expect(observation.forwardedHeader).toBe(
            availability === "absent" ? null : localHeader,
          );
        } else {
          expect(observation.extracted).toBeNull();
          expect(observation.forwardedHeader).toBe("");
          expect(observation.traceId).toBe(expectedFallbacks[0]);
        }
      }
      expect(captured.resumed.traceId).toBe(captured.first.traceId);
      expect(result.getOperations()).toHaveLength(3);
    },
    45000,
  );
});
