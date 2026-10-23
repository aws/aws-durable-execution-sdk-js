// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { invocation, bounded } from "./local-support.mjs";
import { createTelemetry } from "./telemetry.mjs";
import { deferred } from "./scenarios.mjs";

const HEADER =
  "Root=1-6955b900-123456789012345678901234;Parent=1234567890123456;Sampled=1";
const OTHER =
  "Root=1-6955b901-abcdefabcdefabcdefabcdef;Parent=abcdefabcdefabcd;Sampled=1";

function harness(
  view,
  work = async (event, ctx) => ctx.step("saved", () => event.marker),
) {
  const scope = new AsyncLocalStorage();
  const records = [];
  const calls = [];
  const exportGate = deferred();
  const telemetry = createTelemetry({
    current: () => {
      const state = scope.getStore();
      assert(state, "Invocation evidence scope was lost");
      return state;
    },
    record: async (state, phase, fields) => {
      records.push({
        request: state.request,
        execution: state.execution,
        phase,
        ...fields,
      });
    },
    hold: async () => exportGate.promise,
    outside: (fn) => scope.run(undefined, fn),
  });
  const client = {
    async checkpoint(request) {
      calls.push(structuredClone(request));
      return { CheckpointToken: request.CheckpointToken };
    },
    async getExecutionState() {
      return { Operations: [] };
    },
  };
  const handler = withDurableExecution(work, {
    durableExecutionClient: client,
    plugins: [telemetry.factory],
  });
  return {
    records,
    calls,
    exportGate,
    async run(
      marker,
      fields = { xRayTraceId: HEADER },
      mode = "success",
      input,
    ) {
      const event = input ?? invocation("success", { marker });
      const state = {
        event: { marker, otelView: view, otelExport: mode },
        request: marker + "-request",
        execution: event.DurableExecutionArn,
      };
      const context = {
        awsRequestId: state.request,
        getRemainingTimeInMillis: () => 60000,
      };
      Object.defineProperties(
        context,
        Object.getOwnPropertyDescriptors(fields),
      );
      return scope.run(state, () =>
        telemetry.invoke(state, context, () => handler(event, context)),
      );
    },
    async close() {
      exportGate.resolve();
      await telemetry.shutdown();
    },
  };
}

function spans(h, marker) {
  return h.records
    .filter(
      (r) => r.request === marker + "-request" && r.phase === "OTEL_EXPORT",
    )
    .map((r) => r.span);
}

function check(h, marker, expectedHeader = HEADER, sampled = true) {
  const records = h.records.filter((r) => r.request === marker + "-request");
  const entry = records.find((r) => r.phase === "OTEL_ENTER");
  const exit = records.find((r) => r.phase === "OTEL_EXIT");
  assert(entry && exit);
  assert.equal(exit.context_restored, true);
  assert.equal(exit.exporter_shutdowns, 0);
  assert.equal(records.filter((r) => r.phase === "OTEL_FACTORY").length, 1);
  const exported = spans(h, marker);
  if (!sampled) {
    assert.deepEqual(exported, []);
    return;
  }
  const roots = exported.filter((s) => s.name === "Invocation");
  assert.equal(roots.length, 1);
  assert(
    exported.every(
      (s) => s.attributes["durable.execution.arn"] === entry.execution,
    ),
  );
  assert(exported.every((s) => s.start_ns <= s.end_ns));
  if (expectedHeader) {
    const parts = Object.fromEntries(
      expectedHeader.split(";").map((part) => part.split("=")),
    );
    const traceId = parts.Root.slice(2).replaceAll("-", "");
    assert(exported.every((s) => s.trace_id === traceId));
    assert.equal(roots[0].parent_id, parts.Parent);
  }
}

for (const view of ["invocation", "execution"]) {
  for (const [name, fields, expected, sampled] of [
    ["sampled", { xRayTraceId: HEADER }, HEADER, true],
    ["unsampled", { xRayTraceId: HEADER.slice(0, -1) + "0" }, null, false],
    ["empty", { xRayTraceId: "" }, null, true],
    ["null", { xRayTraceId: null }, null, true],
    ["undefined", { xRayTraceId: undefined }, null, true],
    ["invalid", { xRayTraceId: "invalid" }, null, true],
    [
      "unreadable",
      {
        get xRayTraceId() {
          throw new Error("unreadable carrier");
        },
      },
      null,
      true,
    ],
    ["unavailable", {}, OTHER, true],
  ]) {
    test(view + ": public wrapper carrier " + name, async () => {
      const previous = process.env._X_AMZN_TRACE_ID;
      process.env._X_AMZN_TRACE_ID = OTHER;
      const h = harness(view);
      try {
        assert.equal((await h.run("carrier", fields)).Status, "SUCCEEDED");
        check(h, "carrier", expected, sampled);
        if (!expected && sampled)
          assert(
            spans(h, "carrier").every(
              (s) =>
                s.trace_id !== OTHER.split(";")[0].slice(7).replaceAll("-", ""),
            ),
          );
        assert.equal(process.env._X_AMZN_TRACE_ID, OTHER);
      } finally {
        await h.close();
        if (previous === undefined) delete process.env._X_AMZN_TRACE_ID;
        else process.env._X_AMZN_TRACE_ID = previous;
      }
    });
  }

  test(
    view + ": overlapping public invocations isolate provider and spans",
    async () => {
      const gates = { first: deferred(), second: deferred() };
      const entered = { first: deferred(), second: deferred() };
      const h = harness(view, async (event, ctx) =>
        ctx.step("shared-name", async () => {
          entered[event.marker].resolve();
          await gates[event.marker].promise;
          return event.marker;
        }),
      );
      try {
        const first = h.run("first");
        const second = h.run("second", { xRayTraceId: OTHER });
        await bounded(
          Promise.all(Object.values(entered).map((gate) => gate.promise)),
        );
        gates.first.resolve();
        assert.equal((await bounded(first)).Result, JSON.stringify("first"));
        assert(
          !h.records.some(
            (r) => r.request === "second-request" && r.phase === "OTEL_EXIT",
          ),
        );
        gates.second.resolve();
        assert.equal((await bounded(second)).Result, JSON.stringify("second"));
        check(h, "first", HEADER);
        check(h, "second", OTHER);
        const entries = h.records.filter((r) => r.phase === "OTEL_ENTER");
        assert.equal(new Set(entries.map((r) => r.provider)).size, 1);
        assert.equal(
          new Set(
            h.records
              .filter((r) => r.phase === "OTEL_FACTORY")
              .map((r) => r.plugin_instance),
          ).size,
          2,
        );
      } finally {
        for (const gate of Object.values(gates)) gate.resolve();
        await h.close();
      }
    },
  );

  test(view + ": exporter failure leaves shared provider usable", async () => {
    const h = harness(view);
    try {
      assert.equal(
        (await h.run("failed-export", { xRayTraceId: HEADER }, "failure"))
          .Status,
        "SUCCEEDED",
      );
      assert.equal(
        (await h.run("healthy", { xRayTraceId: OTHER })).Status,
        "SUCCEEDED",
      );
      check(h, "healthy", OTHER);
      assert(
        h.records.some(
          (r) => r.phase === "OTEL_EXPORT" && r.outcome === "failure",
        ),
      );
    } finally {
      await h.close();
    }
  });

  test(
    view + ": flush budget returns while a held export remains observable",
    async () => {
      const h = harness(view);
      const started = performance.now();
      try {
        const result = await bounded(
          h.run("held", { xRayTraceId: HEADER }, "held"),
        );
        assert.equal(result.Status, "SUCCEEDED");
        assert(performance.now() - started < 2500);
        assert(h.records.some((r) => r.phase === "OTEL_EXPORT_HELD"));
        assert.equal(spans(h, "held").length, 0);
        h.exportGate.resolve();
        for (
          let i = 0;
          i < 100 && !spans(h, "held").some((s) => s.name === "Invocation");
          i++
        )
          await delay(10);
        check(h, "held");
        assert.equal(
          (await h.run("after-held", { xRayTraceId: OTHER })).Status,
          "SUCCEEDED",
        );
        check(h, "after-held", OTHER);
      } finally {
        await h.close();
      }
    },
  );
}
