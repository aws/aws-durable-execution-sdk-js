import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { test } from "node:test";
import { contextRunner, SPAN_KEY } from "../src/otel-context.js";
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

// Each call uses a new runner, so no registry is cached between tests.
const runWithSpanContext = (sc, fn) => contextRunner()(sc, fn);

// Puts a value on globalThis under key for one test. undefined removes it. The previous
// value is restored after the test.
function withGlobal(t, key, value) {
  const had = key in globalThis;
  const old = globalThis[key];
  if (value === undefined) delete globalThis[key];
  else globalThis[key] = value;
  t.after(() => {
    if (had) globalThis[key] = old;
    else delete globalThis[key];
  });
}

// Puts a registry of major version 1 on globalThis for one test.
const withRegistry = (t, registry) => withGlobal(t, REGISTRY_KEY, registry);

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

// An otelApi object that records its calls. setSpanContext returns a new object, so a
// test can check that with receives exactly that object.
function fakeApi() {
  const root = { name: "root" };
  const calls = { active: 0, set: [], with: [] };
  return {
    calls,
    root,
    context: {
      active: () => {
        calls.active++;
        return root;
      },
      with: (ctx, fn) => {
        calls.with.push(ctx);
        return fn();
      },
    },
    trace: {
      setSpanContext: (ctx, spanContext) => {
        const derived = { parent: ctx, spanContext };
        calls.set.push(derived);
        return derived;
      },
    },
  };
}

// A step, so that the plugin calls runIn for the invocation and for one attempt.
const oneStep = ({ ctx }) => ctx.step({ name: "s", fn: () => "ok" });

test("with otelApi, with receives the context that setSpanContext derives from active()", () => {
  const api = fakeApi();
  const run = contextRunner(api);
  assert.equal(
    run(SC, () => 7),
    7,
  );
  assert.equal(api.calls.active, 1);
  assert.equal(api.calls.set.length, 1);
  assert.equal(api.calls.set[0].parent, api.root);
  assert.equal(api.calls.set[0].spanContext, SC);
  assert.deepEqual(api.calls.with, api.calls.set);
  assert.equal(api.calls.with[0], api.calls.set[0]);
  const error = new Error("boom");
  assert.throws(
    () =>
      run(SC, () => {
        throw error;
      }),
    (e) => e === error,
  );
});

test("otelApi takes precedence over the registry", async (t) => {
  const manager = fakeManager();
  withRegistry(t, { version: "1.9.1", context: manager });
  const api = fakeApi();
  const exporter = fakeExporter();
  await runDurable({
    plugins: [otel(exporter, { otelApi: api })],
    workflow: oneStep,
  });
  assert.equal(manager.calls.length, 0);
  const ids = api.calls.set.map((c) => c.spanContext.spanId);
  assert.ok(ids.includes(idOf(one(exporter.spans(), "Invocation"))));
  assert.ok(ids.includes(idOf(one(exporter.spans(), "s attempt 1"))));
});

test("a registry of another major version: fn runs directly, and one line is logged per process", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  withRegistry(t, undefined);
  const manager = fakeManager();
  withGlobal(t, Symbol.for("opentelemetry.js.api.2"), {
    version: "2.0.0",
    context: manager,
  });
  for (let i = 0; i < 3; i++) {
    assert.equal(
      runWithSpanContext(SC, () => i),
      i,
    );
  }
  // Two plugins, two runs each. Each run is one invocation.
  for (const plugin of [otel(fakeExporter()), otel(fakeExporter())]) {
    for (let i = 0; i < 2; i++) {
      const out = await runDurable({ plugins: [plugin], workflow: oneStep });
      assert.equal(out.status, "SUCCEEDED");
    }
  }
  assert.equal(manager.calls.length, 0);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(
    warn.mock.calls[0].arguments[0],
    "durable-execution-sdk-js-lite-otel: @opentelemetry/api 2.0.0 is not supported for context propagation. Spans from your code do not nest under durable spans. Pass otelApi to createOtelPlugin, or use @opentelemetry/api 1.x.",
  );
});

test("a registry of another major version without a version field is named by its major", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  withRegistry(t, undefined);
  withGlobal(t, Symbol.for("opentelemetry.js.api.3"), {});
  assert.equal(
    runWithSpanContext(SC, () => "x"),
    "x",
  );
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /@opentelemetry\/api 3\.x /);
});

test("without any registry, nothing is logged", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  withRegistry(t, undefined);
  runWithSpanContext(SC, () => {});
  assert.equal(warn.mock.callCount(), 0);
});

test("a registry that appears after the plugin was created is used by the next run", async (t) => {
  withRegistry(t, undefined);
  const runner = contextRunner();
  assert.equal(
    runner(SC, () => 1),
    1,
  );
  const plugin = otel(fakeExporter());
  await runDurable({ plugins: [plugin], workflow: oneStep });
  const manager = fakeManager();
  globalThis[REGISTRY_KEY] = { version: "1.9.1", context: manager };
  runner(SC, () => {});
  assert.equal(manager.calls.length, 1);
  await runDurable({ plugins: [plugin], workflow: oneStep });
  // The workflow function and the step attempt.
  assert.equal(manager.calls.length, 3);
});

test("with otelApi as the real API module, user code sees the attempt span as the active span", async (t) => {
  const api = await loadApi(t);
  if (api === undefined) return;
  const { context, trace, ROOT_CONTEXT } = api;
  assert.ok(context.setGlobalContextManager(alsContextManager(ROOT_CONTEXT)));
  t.after(() => context.disable());
  const seen = {};
  const exporter = fakeExporter();
  await runDurable({
    plugins: [otel(exporter, { otelApi: api })],
    workflow: ({ ctx }) =>
      ctx.step({
        name: "work",
        fn: async () => {
          await new Promise((r) => setImmediate(r));
          seen.work = trace.getSpanContext(context.active());
          seen.recording = trace.getActiveSpan().isRecording();
        },
      }),
  });
  assert.deepEqual(
    seen.work,
    one(exporter.spans(), "work attempt 1").spanContext(),
  );
  assert.equal(seen.recording, false);
  assert.equal(trace.getSpanContext(context.active()), undefined);
});
