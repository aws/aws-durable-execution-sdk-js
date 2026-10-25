import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { test } from "node:test";
import { runWithSpanContext, SPAN_KEY } from "../src/otel-context.js";
import {
  fakeExporter,
  idOf,
  one,
  otel,
  parentOf,
  runDurable,
} from "./helpers.js";

const REGISTRY_KEY = Symbol.for("opentelemetry.js.api.1");
const SC = { traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 };

// Puts a registry on globalThis for one test. undefined removes it. The previous value
// is restored after the test.
function withRegistry(t, registry) {
  const had = REGISTRY_KEY in globalThis;
  const old = globalThis[REGISTRY_KEY];
  if (registry === undefined) delete globalThis[REGISTRY_KEY];
  else globalThis[REGISTRY_KEY] = registry;
  t.after(() => {
    if (had) globalThis[REGISTRY_KEY] = old;
    else delete globalThis[REGISTRY_KEY];
  });
}

// A context with the same setValue and getValue as BaseContext of @opentelemetry/api.
const fakeContext = (values = new Map()) => ({
  getValue: (key) => values.get(key),
  setValue: (key, value) => fakeContext(new Map(values).set(key, value)),
});

// A context manager that records the contexts it receives and runs fn directly.
function fakeManager() {
  const root = fakeContext();
  const calls = [];
  return {
    calls,
    root,
    active: () => root,
    with: (ctx, fn) => {
      calls.push(ctx);
      return fn();
    },
  };
}

test("without a registry, fn runs directly", (t) => {
  withRegistry(t, undefined);
  assert.equal(
    runWithSpanContext(SC, () => 42),
    42,
  );
  const error = new Error("boom");
  assert.throws(
    () =>
      runWithSpanContext(SC, () => {
        throw error;
      }),
    (e) => e === error,
  );
});

test("a registry without a context manager runs fn directly", (t) => {
  withRegistry(t, { version: "1.9.1" });
  assert.equal(
    runWithSpanContext(SC, () => "x"),
    "x",
  );
});

test("with a context manager, fn runs in a context that holds a non-recording span", (t) => {
  const manager = fakeManager();
  withRegistry(t, { version: "1.9.1", context: manager });
  let ran = false;
  const out = runWithSpanContext(SC, () => {
    ran = true;
    return "out";
  });
  assert.equal(out, "out");
  assert.ok(ran);
  assert.equal(manager.calls.length, 1);
  // The active context is not changed. The manager receives a derived context.
  assert.equal(manager.root.getValue(SPAN_KEY), undefined);
  const span = manager.calls[0].getValue(SPAN_KEY);
  assert.equal(span.spanContext(), SC);
  assert.equal(span.isRecording(), false);
  assert.ok(Object.isFrozen(span));
  for (const m of [
    "setAttribute",
    "setAttributes",
    "addEvent",
    "addLink",
    "addLinks",
    "setStatus",
    "updateName",
  ]) {
    assert.equal(span[m]("k", "v"), span, m);
  }
  assert.equal(span.end(), undefined);
  assert.equal(span.recordException(new Error("e")), undefined);
});

test("with a context manager, a throw of fn passes through", (t) => {
  withRegistry(t, { version: "1.9.1", context: fakeManager() });
  const error = new Error("boom");
  assert.throws(
    () =>
      runWithSpanContext(SC, () => {
        throw error;
      }),
    (e) => e === error,
  );
});

test("SPAN_KEY is the key of @opentelemetry/api", () => {
  assert.equal(SPAN_KEY, Symbol.for("OpenTelemetry Context Key SPAN"));
});

// The tests below use the real @opentelemetry/api from the repository's node_modules. The
// package does not declare it. So a test is skipped when it is not installed.
async function loadApi(t) {
  try {
    return await import("@opentelemetry/api");
  } catch {
    t.skip("@opentelemetry/api is not installed");
    return undefined;
  }
}

// A test-only context manager. The plugin source must not use node:async_hooks, but a
// test may. It mirrors AsyncLocalStorageContextManager from
// @opentelemetry/context-async-hooks.
function alsContextManager(rootContext) {
  const als = new AsyncLocalStorage();
  return {
    active: () => als.getStore() ?? rootContext,
    with: (ctx, fn, thisArg, ...args) =>
      als.run(ctx, () => fn.call(thisArg, ...args)),
    bind: (_ctx, target) => target,
    enable() {
      return this;
    },
    disable() {
      als.disable();
      return this;
    },
  };
}

test("with the real API and a context manager, user code sees the durable span as the active span", async (t) => {
  const api = await loadApi(t);
  if (api === undefined) return;
  const { context, trace, ROOT_CONTEXT } = api;
  assert.ok(context.setGlobalContextManager(alsContextManager(ROOT_CONTEXT)));
  t.after(() => context.disable());
  const seen = {};
  const active = () => trace.getSpanContext(context.active());
  const exporter = fakeExporter();
  await runDurable({
    plugins: [otel(exporter)],
    workflow: async ({ ctx }) => {
      seen.workflow = active();
      await ctx.runInChildContext({
        name: "group",
        fn: async ({ ctx: c }) => {
          seen.group = active();
          await c.step({
            name: "work",
            fn: async () => {
              await new Promise((r) => setImmediate(r));
              seen.work = active();
              seen.recording = trace.getActiveSpan().isRecording();
            },
          });
        },
      });
    },
  });
  const spans = exporter.spans();
  assert.deepEqual(seen.workflow, one(spans, "Invocation").spanContext());
  assert.deepEqual(seen.group, one(spans, "group").spanContext());
  assert.deepEqual(seen.work, one(spans, "work attempt 1").spanContext());
  assert.equal(seen.recording, false);
  assert.equal(
    parentOf(one(spans, "work attempt 1")),
    idOf(one(spans, "work")),
  );
  // After the run, no span is active.
  assert.equal(active(), undefined);
});

test("with the real API and no context manager, no span is active in user code", async (t) => {
  const api = await loadApi(t);
  if (api === undefined) return;
  const { context, trace } = api;
  let seen = "unset";
  await runDurable({
    plugins: [otel(fakeExporter())],
    workflow: ({ ctx }) =>
      ctx.step({
        name: "s",
        fn: () => {
          seen = trace.getSpanContext(context.active());
        },
      }),
  });
  assert.equal(seen, undefined);
});
