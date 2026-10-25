import assert from "node:assert/strict";
import { test } from "node:test";
import { otel, runDurable } from "./helpers.js";

const workflow = async ({ ctx }) => {
  await ctx.step({ name: "a", fn: () => 1 });
  await ctx.wait({ name: "w", seconds: 1 });
  return "done";
};

const exporters = {
  "reports FAILED": {
    export: (_spans, cb) =>
      cb({ code: 1, error: new Error("collector said no") }),
    reason: /collector said no/,
  },
  "reports FAILED without an error": {
    export: (_spans, cb) => cb({ code: 1 }),
    reason: /export failed/,
  },
  throws: {
    export: () => {
      throw new Error("exporter threw");
    },
    reason: /exporter threw/,
  },
  "never calls back": {
    export: () => {},
    reason: /timed out after 50 ms/,
  },
  "fails in forceFlush": {
    export: (_spans, cb) => cb({ code: 0 }),
    forceFlush: () => Promise.reject(new Error("flush failed")),
    reason: /flush failed/,
  },
};

for (const [label, { reason, ...exporter }] of Object.entries(exporters)) {
  test(`an exporter that ${label} does not change the workflow`, async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const started = Date.now();
    const run = await runDurable({
      workflow,
      plugins: [otel(exporter, { exportTimeoutMs: 50 })],
    });
    assert.equal(run.status, "SUCCEEDED");
    assert.equal(run.result, "done");
    assert.deepEqual(run.invocationErrors, []);
    // Two invocations, each waits at most 50 ms.
    assert.ok(Date.now() - started < 1000);
    assert.equal(warn.mock.callCount(), 2);
    assert.match(warn.mock.calls[0].arguments[0], reason);
  });
}

test("a successful export with forceFlush logs nothing", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  let flushed = 0;
  await runDurable({
    workflow,
    plugins: [
      otel({
        export: (_spans, cb) => cb({ code: 0 }),
        forceFlush: async () => {
          flushed++;
        },
      }),
    ],
  });
  assert.equal(flushed, 2);
  assert.equal(warn.mock.callCount(), 0);
});
