import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  byName,
  fakeExporter,
  idOf,
  info,
  otel,
  runDurable,
} from "./helpers.js";

// A plugin that records the start of onInvocationEnd in the log of the exporter. It is
// the first plugin, so its hook runs before the OpenTelemetry plugin's hook.
const marker = (log) => () => ({
  onInvocationEnd() {
    log.push("end");
  },
});

// An exporter that logs each call, so a test can tell the exports before the end of an
// invocation from the export at the end.
function loggingExporter() {
  const exporter = fakeExporter();
  const log = [];
  const exportBatch = exporter.export;
  exporter.log = log;
  exporter.export = (spans, cb) => {
    log.push(spans);
    exportBatch(spans, cb);
  };
  return exporter;
}

const attemptInfo = (n) => ({
  kind: "attempt",
  id: `op-${n}`,
  parentId: undefined,
  name: `s${n}`,
  type: "STEP",
  subType: "Step",
  attempt: 1,
  fn: () => n,
});

const end = () => ({
  status: "PENDING",
  result: undefined,
  error: undefined,
  operations: [],
});

const slowSteps = async ({ ctx }) => {
  for (const name of ["a", "b", "c"]) {
    await ctx.step({ name, fn: () => sleep(30) });
  }
  await ctx.wait({ name: "w", seconds: 1 });
  for (const name of ["d", "e"]) {
    await ctx.step({ name, fn: () => sleep(30) });
  }
  return "done";
};

test("finished spans are exported during the invocation, and every span exactly once", async () => {
  const exporter = loggingExporter();
  const run = await runDurable({
    workflow: slowSteps,
    plugins: [marker(exporter.log), otel(exporter, { flushIntervalMs: 20 })],
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.invocations, 2);
  // The batches before the first "end" were sent while invocation 1 ran.
  const early = exporter.log.indexOf("end");
  assert.ok(early > 1, `exports before the end: ${early}`);
  const earlyNames = exporter.log
    .slice(0, early)
    .flat()
    .map((s) => s.name);
  assert.ok(earlyNames.includes("a") && earlyNames.includes("a attempt 1"));

  const spans = exporter.spans();
  const ids = spans.map(idOf);
  assert.equal(new Set(ids).size, ids.length, "a span id was exported twice");
  for (const name of ["a", "b", "c", "w", "d", "e"]) {
    assert.equal(byName(spans, name).length, 1, name);
    assert.equal(
      byName(spans, `${name} attempt 1`).length,
      name === "w" ? 0 : 1,
    );
  }
  assert.equal(byName(spans, "Invocation").length, 2);
  assert.equal(byName(spans, "workflow").length, 1);
  // The invocation and workflow spans are sent only at the end of an invocation.
  for (const batch of exporter.log.slice(0, early)) {
    assert.deepEqual(byName(batch, "Invocation"), []);
    assert.deepEqual(byName(batch, "workflow"), []);
  }
});

test("the spans of quick steps are exported while a long step runs", async () => {
  const exporter = fakeExporter();
  let seen;
  const received = new Promise((resolve) => {
    seen = resolve;
  });
  const exportBatch = exporter.export;
  exporter.export = (spans, cb) => {
    exportBatch(spans, cb);
    const names = exporter.spans().map((s) => s.name);
    const wanted = ["q1", "q1 attempt 1", "q2", "q2 attempt 1"];
    if (wanted.every((n) => names.includes(n))) seen(true);
  };
  let exportedBeforeLongEnded;
  await runDurable({
    plugins: [otel(exporter, { flushIntervalMs: 20 })],
    workflow: async ({ ctx }) => {
      await ctx.step({ name: "q1", fn: () => 1 });
      await ctx.step({ name: "q2", fn: () => 2 });
      await ctx.step({
        name: "long",
        fn: async () => {
          exportedBeforeLongEnded = await Promise.race([
            received,
            sleep(100).then(() => false),
          ]);
        },
      });
    },
  });
  assert.equal(exportedBeforeLongEnded, true);
});

test("flushIntervalMs 0 exports once per invocation", async () => {
  const exporter = fakeExporter();
  const run = await runDurable({
    workflow: slowSteps,
    plugins: [otel(exporter, { flushIntervalMs: 0 })],
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(exporter.batches.length, run.invocations);
  assert.equal(byName(exporter.batches[0], "a").length, 1);
});

test("an earlier export that never calls back delays the end at most exportTimeoutMs", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const exporter = fakeExporter();
  const exportBatch = exporter.export;
  let calls = 0;
  // The first export never calls back. The later exports succeed.
  exporter.export = (spans, cb) => {
    if (++calls > 1) exportBatch(spans, cb);
  };
  let endedAt;
  const run = await runDurable({
    plugins: [
      otel(exporter, { flushIntervalMs: 20, exportTimeoutMs: 50 }),
      () => ({
        onInvocationEnd() {
          endedAt = Date.now();
        },
      }),
    ],
    workflow: async ({ ctx }) => {
      await ctx.step({ name: "a", fn: () => 1 });
      await ctx.step({ name: "b", fn: () => sleep(30) });
      return "done";
    },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.result, "done");
  assert.ok(Date.now() - endedAt < 50 + 30, `${Date.now() - endedAt} ms`);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /timed out after 50 ms/);
  // The first batch is lost. The final batch is sent after it timed out.
  assert.equal(byName(exporter.spans(), "Invocation").length, 1);
});

test("the final export is dropped when earlier exports still run at the deadline", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  let calls = 0;
  const exporter = {
    export() {
      calls++;
    },
  };
  const plugin = otel(exporter, { flushIntervalMs: 10, exportTimeoutMs: 50 })(
    info(),
  );
  plugin.wrap(attemptInfo(1));
  await sleep(15);
  // The first export runs and never calls back. This span waits for the next flush.
  plugin.wrap(attemptInfo(2));
  await sleep(15);
  // Export 1 times out about 50 ms after it started. Export 2 starts then, and runs
  // past the deadline of the final export.
  const started = Date.now();
  await plugin.onInvocationEnd(end());
  const waited = Date.now() - started;
  assert.ok(waited >= 45 && waited < 80, `${waited} ms`);
  assert.equal(calls, 2);
  assert.equal(warn.mock.callCount(), 2);
  for (const call of warn.mock.calls) {
    assert.match(call.arguments[0], /trace export failed: timed out after 50/);
  }
  // Export 2 times out after onInvocationEnd returned. The final export never runs.
  await sleep(50);
  assert.equal(calls, 2);
  assert.equal(warn.mock.callCount(), 3);
});

test("the flush timer is unref'd and cleared at the end of the invocation", async (t) => {
  const set = t.mock.method(globalThis, "setTimeout");
  const clear = t.mock.method(globalThis, "clearTimeout");
  const exporter = fakeExporter();
  const plugin = otel(exporter, { flushIntervalMs: 20 })(info());
  plugin.wrap(attemptInfo(1));
  assert.equal(set.mock.callCount(), 1);
  const timer = set.mock.calls[0].result;
  assert.equal(timer.hasRef(), false);
  await plugin.onInvocationEnd(end());
  assert.ok(clear.mock.calls.some((c) => c.arguments[0] === timer));
  // A span after the end is dropped and sets no timer.
  const timers = set.mock.callCount();
  plugin.wrap(attemptInfo(2));
  assert.equal(set.mock.callCount(), timers);
  await sleep(40);
  assert.equal(exporter.batches.length, 1);
  assert.equal(byName(exporter.spans(), "s1 attempt 1").length, 1);
  assert.equal(byName(exporter.spans(), "s2 attempt 1").length, 0);
});

// A Lambda context whose deadline is ms from now.
const deadlineIn = (ms) => {
  const deadline = Date.now() + ms;
  return { getRemainingTimeInMillis: () => deadline - Date.now() };
};

test("the final export ends 500 ms before the Lambda timeout", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  let calls = 0;
  // The export never calls back, like an unreachable collector.
  const exporter = {
    export() {
      calls++;
    },
  };
  const plugin = otel(exporter, { flushIntervalMs: 0, exportTimeoutMs: 3000 })(
    info({ lambdaContext: deadlineIn(700) }),
  );
  const started = Date.now();
  await plugin.onInvocationEnd(end());
  const waited = Date.now() - started;
  // 700 ms left, minus the 500 ms margin: about 200 ms, not exportTimeoutMs.
  assert.ok(waited >= 150 && waited < 350, `${waited} ms`);
  assert.equal(calls, 1);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    warn.mock.calls[0].arguments[0],
    /timed out after (19\d|200) ms/,
  );
});

test("an earlier export that never calls back delays the end at most until 500 ms before the Lambda timeout", async (t) => {
  t.mock.method(console, "warn", () => {});
  const plugin = otel(
    { export() {} },
    {
      flushIntervalMs: 10,
      exportTimeoutMs: 3000,
    },
  )(info({ lambdaContext: deadlineIn(800) }));
  plugin.wrap(attemptInfo(1));
  // The interval export starts and never calls back.
  await sleep(20);
  const started = Date.now();
  await plugin.onInvocationEnd(end());
  const waited = Date.now() - started;
  // About 800 - 20 - 500 = 280 ms.
  assert.ok(waited >= 200 && waited < 450, `${waited} ms`);
});

test("with less than 500 ms before the Lambda timeout, the final export is skipped", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const exporter = fakeExporter();
  const plugin = otel(exporter, { flushIntervalMs: 0 })(
    info({ lambdaContext: deadlineIn(400) }),
  );
  plugin.wrap(attemptInfo(1));
  const started = Date.now();
  await plugin.onInvocationEnd(end());
  assert.ok(Date.now() - started < 50);
  assert.equal(exporter.batches.length, 0);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    warn.mock.calls[0].arguments[0],
    /trace export skipped: the invocation ends less than 500 ms before its Lambda timeout/,
  );
});

test("without getRemainingTimeInMillis, the final export gets exportTimeoutMs", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const plugin = otel(
    { export() {} },
    {
      flushIntervalMs: 0,
      exportTimeoutMs: 60,
    },
  )(info({ lambdaContext: {} }));
  const started = Date.now();
  await plugin.onInvocationEnd(end());
  const waited = Date.now() - started;
  assert.ok(waited >= 55 && waited < 150, `${waited} ms`);
  assert.match(warn.mock.calls[0].arguments[0], /timed out after 60 ms/);
});
