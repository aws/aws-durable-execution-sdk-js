import type {
  InvocationInfo,
  InvocationEndInfo,
  OperationInfo,
} from "@aws/durable-execution-sdk-js";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";
import { flushTracerProvider } from "../otel-plugin-provider";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

const invocation = (requestId = "first"): InvocationInfo => ({
  requestId,
  executionArn: `arn:aws:lambda:us-east-1:123456789012:function:test:$LATEST:${requestId}`,
  executionInput: {},
  operations: {},
  updatedOperations: {},
  isFirstInvocation: true,
});
const ending = (info: InvocationInfo): InvocationEndInfo => ({
  ...info,
  status: "SUCCEEDED",
});

describe.each([ExecutionOtelPlugin, InvocationOtelPlugin])(
  "%p bounded flush rounds",
  (Plugin) => {
    let exporter: InMemorySpanExporter;
    let provider: NodeTracerProvider;
    let plugin: ExecutionOtelPlugin | InvocationOtelPlugin;
    let log: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers();
      log = jest.spyOn(console, "error").mockImplementation(() => {});
      exporter = new InMemorySpanExporter();
      plugin = new Plugin({
        flushTimeoutMillis: 70,
        contextExtractor: () => undefined,
        tracerProviderFactory: (ids) =>
          (provider = new NodeTracerProvider({
            idGenerator: ids(),
            spanProcessors: [new SimpleSpanProcessor(exporter)],
          })),
      });
    });

    afterEach(async () => {
      // Complete InMemorySpanExporter's zero-delay acknowledgments.
      await jest.advanceTimersByTimeAsync(1);
      await provider.shutdown();
      jest.useRealTimers();
      log.mockRestore();
      trace.disable();
      context.disable();
    });

    it("shares one deadline across rounds and drains known completions after timeout", async () => {
      const firstCalled = gate(),
        secondCalled = gate();
      const first = gate(),
        second = gate();
      const flush = jest
        .spyOn(provider, "forceFlush")
        .mockImplementationOnce(async () => {
          firstCalled.open();
          await first.opened;
        })
        .mockImplementationOnce(async () => {
          secondCalled.open();
          await second.opened;
        });
      const info = invocation();
      await plugin.onInvocationStart(info);
      let settled = false;
      const end = plugin.onInvocationEnd(ending(info)).then(() => {
        settled = true;
      });
      const complete = async (id: string, status: "SUCCEEDED" | "FAILED") => {
        const operation: OperationInfo = {
          id,
          name: id,
          type: "CALLBACK",
          status,
          isReplay: false,
          startTimestamp: new Date(10),
          endTimestamp: new Date(20),
        };
        await plugin.onOperationChange({
          executionArn: info.executionArn,
          operations: { [id]: operation },
          updatedOperations: { [id]: operation },
        });
      };
      try {
        await firstCalled.opened;
        await jest.advanceTimersByTimeAsync(40);
        await complete("during-first", "SUCCEEDED");
        first.open();
        await secondCalled.opened;
        await complete("during-timeout", "FAILED");
        await jest.advanceTimersByTimeAsync(29);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(settled).toBe(true);
        await end;
        expect(flush).toHaveBeenCalledTimes(2);
        for (const [name, status] of [
          ["during-first", SpanStatusCode.OK],
          ["during-timeout", SpanStatusCode.ERROR],
        ] as const) {
          const spans = exporter
            .getFinishedSpans()
            .filter((span) => span.name === name);
          expect(spans).toHaveLength(1);
          expect(spans[0].status.code).toBe(status);
          expect(spans[0].events).toHaveLength(0);
        }
      } finally {
        first.open();
        second.open();
        await end;
      }
    });

    it("uses only the remaining budget for the final ordinary-operation batch", async () => {
      const firstCalled = gate(),
        secondCalled = gate();
      const first = gate(),
        second = gate();
      const flush = jest
        .spyOn(provider, "forceFlush")
        .mockImplementationOnce(async () => {
          firstCalled.open();
          await first.opened;
        })
        .mockImplementationOnce(async () => {
          secondCalled.open();
          await second.opened;
        });
      const info = invocation();
      await plugin.onInvocationStart(info);
      let settled = false;
      const end = plugin.onInvocationEnd(ending(info)).then(() => {
        settled = true;
      });
      try {
        await firstCalled.opened;
        await jest.advanceTimersByTimeAsync(40);
        const late: OperationInfo = {
          id: "late",
          name: "late",
          type: "STEP",
          status: "STARTED",
          isReplay: false,
        };
        await plugin.onOperationStart(late);
        await plugin.onOperationAttemptStart({ ...late, attempt: 1 });
        await plugin.onOperationAttemptEnd({
          ...late,
          attempt: 1,
          outcome: "SUCCEEDED",
        });
        await plugin.onOperationEnd({ ...late, status: "SUCCEEDED" });
        first.open();
        await secondCalled.opened;
        await jest.advanceTimersByTimeAsync(29);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(settled).toBe(true);
        await end;
        expect(flush).toHaveBeenCalledTimes(2);
        expect(
          exporter.getFinishedSpans().filter((span) => span.name === "late"),
        ).toHaveLength(1);
        expect(
          exporter
            .getFinishedSpans()
            .filter((span) => span.name === "late attempt 1"),
        ).toHaveLength(1);
      } finally {
        first.open();
        second.open();
        await end;
      }
    });

    it("preserves reuse after timeout and handles the old provider's late rejection", async () => {
      const called = gate(),
        release = gate();
      const flush = jest
        .spyOn(provider, "forceFlush")
        .mockImplementationOnce(async () => {
          called.open();
          await release.opened;
          throw new Error("late exporter failure");
        })
        .mockResolvedValue(undefined);
      const shutdown = jest.spyOn(provider, "shutdown");
      const first = invocation();
      await plugin.onInvocationStart(first);
      const end = plugin.onInvocationEnd(ending(first));
      try {
        await called.opened;
        await jest.advanceTimersByTimeAsync(70);
        await end;
        expect(shutdown).not.toHaveBeenCalled();
        const next = invocation("next");
        await plugin.onInvocationStart(next);
        await plugin.onInvocationEnd(ending(next));
        expect(flush).toHaveBeenCalledTimes(2);
        expect(
          exporter.getFinishedSpans().filter((s) => s.name === "Workflow"),
        ).toHaveLength(2);
        release.open();
        await expect(flush.mock.results[0].value).rejects.toThrow(
          "late exporter failure",
        );
      } finally {
        release.open();
        await end;
      }
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
      "rejects invalid budget %s before invoking a provider factory",
      (flushTimeoutMillis) => {
        const factory = jest.fn(() => provider);
        expect(
          () =>
            new Plugin({ flushTimeoutMillis, tracerProviderFactory: factory }),
        ).toThrow(RangeError);
        expect(factory).not.toHaveBeenCalled();
      },
    );
  },
);

describe("flushTracerProvider timer ownership", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each(["resolved", "rejected"] as const)(
    "releases its budget timer when the provider is %s",
    async (outcome) => {
      const failure = new Error("provider failure");
      const provider = {
        getTracer: jest.fn(),
        forceFlush: jest.fn(async () => {
          if (outcome === "rejected") throw failure;
        }),
      };
      const flushing = flushTracerProvider(provider, false, 70);
      if (outcome === "rejected") {
        await expect(flushing).rejects.toBe(failure);
      } else {
        await flushing;
      }
      // This fixture creates no spans and no exporter acknowledgment timers.
      expect(jest.getTimerCount()).toBe(0);
    },
  );
});
