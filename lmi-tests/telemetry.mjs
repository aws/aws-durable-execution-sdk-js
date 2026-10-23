// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { context as otelContext } from "@opentelemetry/api";
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  AlwaysOnSampler,
} from "@opentelemetry/sdk-trace-node";
import {
  createExecutionOtelPluginFactory,
  createInvocationOtelPluginFactory,
} from "@aws/durable-execution-sdk-js-otel";

const nanos = ([seconds, fraction]) => seconds * 1e9 + fraction;
const serialize = (span) => ({
  name: span.name,
  trace_id: span.spanContext().traceId,
  span_id: span.spanContext().spanId,
  parent_id: span.parentSpanContext?.spanId ?? span.parentSpanId ?? null,
  sampled: Boolean(span.spanContext().traceFlags & 1),
  start_ns: nanos(span.startTime),
  end_ns: nanos(span.endTime),
  status: ["UNSET", "OK", "ERROR"][span.status.code],
  attributes: { ...span.attributes },
});

/** A real exporter and shared provider; only the evidence sink is injected. */
export function createTelemetry({ current, record, hold, outside, snapshot }) {
  const runtimes = new Map();
  const instances = new WeakMap();
  const runtime = (view) => {
    if (!["invocation", "execution"].includes(view))
      throw new Error("Unknown OTel view");
    if (!runtimes.has(view)) {
      const value = { identity: randomUUID(), shutdowns: 0 };
      const exporter = {
        export(spans, callback) {
          // Capture the independently observed caller before leaving SDK scope.
          // Never choose an expected owner from the span's own attributes.
          const state = current();
          const mode = state.event.otelExport ?? "success";
          outside(async () => {
            if (mode === "held") {
              await record(state, "OTEL_EXPORT_HELD", { view });
              await hold(state, "export");
            }
            for (const span of spans)
              await record(state, "OTEL_EXPORT", {
                view,
                outcome: mode === "failure" ? "failure" : "success",
                span: serialize(span),
              });
          }).then(
            () => callback({ code: mode === "failure" ? 1 : 0 }),
            (error) => {
              state.otelErrors ??= [];
              state.otelErrors.push(error.name);
              callback({ code: 1, error });
            },
          );
        },
        async shutdown() {
          value.shutdowns++;
        },
      };
      const create =
        view === "invocation"
          ? createInvocationOtelPluginFactory
          : createExecutionOtelPluginFactory;
      value.factory = create({
        flushTimeoutMillis: 1000,
        tracerProviderFactory(createIdGenerator) {
          value.provider = new NodeTracerProvider({
            idGenerator: createIdGenerator(),
            sampler: new AlwaysOnSampler(),
            spanProcessors: [new SimpleSpanProcessor(exporter)],
          });
          return value.provider;
        },
      });
      runtimes.set(view, value);
    }
    return runtimes.get(view);
  };

  return {
    factory: {
      createPlugin(info) {
        const state = current();
        const value = runtime(state.event.otelView);
        const plugin = value.factory.createPlugin(info);
        if (!instances.has(plugin)) instances.set(plugin, randomUUID());
        const recorded = record(state, "OTEL_FACTORY", {
          plugin_instance: instances.get(plugin),
          plugin_execution: info.executionArn,
        }).catch((error) => {
          state.otelErrors ??= [];
          state.otelErrors.push(error.name);
        });
        state.otelFactoryWrites ??= [];
        state.otelFactoryWrites.push(recorded);
        return plugin;
      },
    },
    async invoke(state, lambdaContext, invoke) {
      const view = state.event.otelView;
      const value = runtime(view);
      const before = otelContext.active();
      let carrier = null;
      let carrierError = null;
      const available = "xRayTraceId" in lambdaContext;
      try {
        const raw = lambdaContext.xRayTraceId;
        carrier = typeof raw === "string" ? raw : null;
      } catch (error) {
        carrierError = error.name;
      }
      await record(state, "OTEL_ENTER", {
        view,
        provider: value.identity,
        carrier,
        carrier_available: available,
        carrier_error: carrierError,
        carrier_source: "runtime_context",
      });
      const complete = (outcome) => {
        state.sdkCompletedAt = Date.now() / 1000;
        state.closed = true;
        state.sdkResourceSnapshot = snapshot?.(state);
        return outcome;
      };
      const outcome = await invoke().then(
        (response) => complete({ response }),
        (error) => complete({ error }),
      );
      let evidenceError;
      try {
        await Promise.all(state.otelFactoryWrites ?? []);
        await record(state, "OTEL_EXIT", {
          view,
          provider: value.identity,
          context_restored: otelContext.active() === before,
          exporter_shutdowns: value.shutdowns,
          evidence_errors: state.otelErrors ?? [],
        });
      } catch (error) {
        evidenceError = error;
      }
      if ("error" in outcome) throw outcome.error;
      if (evidenceError) throw evidenceError;
      if (state.otelErrors?.length)
        throw new Error("OTel evidence writes failed");
      return outcome.response;
    },
    async shutdown() {
      for (const value of runtimes.values()) await value.provider?.shutdown();
    },
  };
}
