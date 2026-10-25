import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createTelemetryPlugin } from "../src/index.js";
import {
  ARN,
  createInMemoryService,
  createRetryStrategy,
  fakeExporter,
  runDurable,
  START_SECONDS,
} from "./helpers.js";

const START_ISO = new Date(START_SECONDS * 1000).toISOString();

// step, wait, step: two invocations.
const threeSteps = async ({ ctx }) => {
  const a = await ctx.step({ name: "a", fn: () => 1 });
  await ctx.wait({ name: "w", seconds: 10 });
  const b = await ctx.step({ name: "b", fn: () => 2 });
  return { sum: a + b };
};

function run(workflow, config = {}, options = {}) {
  const exporter = config.exporter ?? fakeExporter();
  const plugin = createTelemetryPlugin({ exporters: [exporter], ...config });
  return runDurable({ workflow, plugins: [plugin], ...options }).then(
    (result) => ({ result, records: exporter.records }),
  );
}

test("on-complete emits one SUCCEEDED record after a run of several invocations", async () => {
  const { result, records } = await run(threeSteps, {}, { input: { n: 1 } });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.invocations, 2);
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.recordType, "DurableExecutionTelemetry");
  assert.equal(record.schemaVersion, "1.0");
  assert.equal(record.status, "SUCCEEDED");
  assert.equal(record.executionArn, ARN);
  assert.equal(record.executionName, "local");
  assert.equal(record.functionName, "workflow");
  assert.equal(record.functionQualifier, "$LATEST");
  assert.equal(record.region, "us-east-1");
  assert.equal(record.accountId, "123456789012");
  // The EXECUTION record's StartTimestamp, not the start of the last invocation.
  assert.equal(record.startTime, START_ISO);
  assert.equal(record.endTime, record.emittedAt);
  assert.equal(
    record.durationMs,
    Date.parse(record.endTime) - Date.parse(record.startTime),
  );
  assert.deepEqual(record.input, { n: 1 });
  assert.deepEqual(record.output, { sum: 3 });
  assert.equal(record.error, undefined);
  assert.deepEqual(
    record.operations.map((op) => [op.name, op.type, op.status]),
    [
      ["a", "STEP", "SUCCEEDED"],
      ["w", "WAIT", "SUCCEEDED"],
      ["b", "STEP", "SUCCEEDED"],
    ],
  );
  const wait = record.operations[1];
  assert.equal(wait.id, result.getOperation("w").Id);
  assert.equal(wait.subType, "Wait");
  assert.equal(wait.startTime, START_ISO);
  assert.equal(wait.durationMs, 10_000);
  assert.equal(
    wait.endTime,
    new Date((START_SECONDS + 10) * 1000).toISOString(),
  );
  assert.equal(record.operations[0].attempt, 1);
});

test("a FAILED record holds the execution error and no output", async () => {
  const { result, records } = await run(async ({ ctx }) => {
    await ctx.step({ name: "a", fn: () => 1 });
    throw new TypeError("bad input");
  });
  assert.equal(result.status, "FAILED");
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "FAILED");
  assert.deepEqual(records[0].error, {
    name: "TypeError",
    message: "bad input",
  });
  assert.equal(records[0].output, undefined);
  assert.ok(records[0].endTime);
});

test("on-failure emits nothing for SUCCEEDED and one record for FAILED", async () => {
  const ok = await run(threeSteps, { emitMode: "on-failure" });
  assert.equal(ok.result.status, "SUCCEEDED");
  assert.deepEqual(ok.records, []);

  const failed = await run(
    async ({ ctx }) => {
      await ctx.wait({ name: "w", seconds: 1 });
      throw new Error("boom");
    },
    { emitMode: "on-failure" },
  );
  assert.equal(failed.records.length, 1);
  assert.equal(failed.records[0].status, "FAILED");
});

test("on-change emits RUNNING records and then the final record", async () => {
  const { records } = await run(threeSteps, { emitMode: "on-change" });
  assert.ok(records.length >= 4);
  assert.deepEqual(
    records.slice(0, -1).map((r) => r.status),
    records.slice(0, -1).map(() => "RUNNING"),
  );
  assert.equal(records.at(-1).status, "SUCCEEDED");
  for (const r of records.slice(0, -1)) {
    assert.equal(r.endTime, undefined);
    assert.equal(r.durationMs, undefined);
    assert.equal(r.output, undefined);
    assert.equal(r.startTime, START_ISO);
  }
  // The first record comes from the factory, before any operation exists.
  assert.deepEqual(records[0].operations, []);
  // The first invocation ends PENDING at the wait. Its record lists a and w.
  const pendingEnd = records.find((r) =>
    r.operations.some((op) => op.name === "w" && op.status === "STARTED"),
  );
  assert.ok(pendingEnd);
});

test("emittedAt strictly increases within one invocation", async () => {
  const { records } = await run(
    async ({ ctx }) => {
      for (let i = 0; i < 5; i++)
        await ctx.step({ name: `s${i}`, fn: () => i });
    },
    { emitMode: "on-change" },
  );
  const emitted = records.map((r) => Date.parse(r.emittedAt));
  for (let i = 1; i < emitted.length; i++) {
    assert.ok(emitted[i] > emitted[i - 1], `record ${i}`);
  }
});

test("operations: top-level, all and none; unnamed operations are left out", async () => {
  const workflow = async ({ ctx }) => {
    await ctx.step({ name: "top", fn: () => 1 });
    await ctx.step({ fn: () => "unnamed" });
    await ctx.runInChildContext({
      name: "group",
      fn: ({ ctx: child }) => child.step({ name: "inner", fn: () => 2 }),
    });
  };
  const names = async (operations) =>
    (await run(workflow, { operations })).records[0].operations.map(
      (op) => op.name,
    );
  assert.deepEqual(await names(undefined), ["top", "group"]);
  assert.deepEqual(await names("top-level"), ["top", "group"]);
  assert.deepEqual(await names("all"), ["top", "group", "inner"]);
  assert.deepEqual(await names("none"), []);

  const { records } = await run(workflow, { operations: "all" });
  const [, group, inner] = records[0].operations;
  assert.equal(inner.parentId, group.id);
  assert.equal(group.type, "CONTEXT");
  assert.equal(group.subType, "RunInChildContext");
});

test("includeInput and includeOutput false leave out input and output", async () => {
  const { records } = await run(
    threeSteps,
    { includeInput: false, includeOutput: false },
    { input: { secret: 1 } },
  );
  assert.equal(records[0].input, undefined);
  assert.equal(records[0].output, undefined);
});

test("attempt counts the attempts of a retried step; a failed step has an error", async () => {
  let calls = 0;
  const { records } = await run(async ({ ctx }) => {
    await ctx.step({
      name: "flaky",
      retryStrategy: createRetryStrategy({ jitter: false }),
      fn: () => {
        calls++;
        if (calls < 3) throw new Error("not yet");
        return "ok";
      },
    });
    try {
      await ctx.step({
        name: "broken",
        retryStrategy: () => ({ shouldRetry: false }),
        fn: () => {
          throw new RangeError("out of range");
        },
      });
    } catch {}
  });
  const [flaky, broken] = records[0].operations;
  assert.equal(flaky.attempt, 3);
  assert.equal(flaky.status, "SUCCEEDED");
  assert.equal(flaky.error, undefined);
  assert.equal(broken.status, "FAILED");
  assert.equal(broken.attempt, 1);
  assert.deepEqual(broken.error, {
    name: "RangeError",
    message: "out of range",
  });
});

test("callback and invoke errors appear in operation records", async () => {
  const { records } = await run(
    async ({ ctx }) => {
      const { result } = await ctx.createCallback({ name: "cb" });
      await result.catch(() => {});
      await ctx
        .invoke({ name: "call", functionName: "other:1" })
        .catch(() => {});
    },
    {},
    {
      onCallback: () => ({
        error: { ErrorType: "Rejected", ErrorMessage: "no" },
      }),
      functions: {
        "other:1": () => {
          throw new SyntaxError("callee failed");
        },
      },
    },
  );
  const [cb, call] = records[0].operations;
  assert.deepEqual(cb.error, { name: "Rejected", message: "no" });
  assert.deepEqual(call.error, {
    name: "SyntaxError",
    message: "callee failed",
  });
});

test("ISO string timestamps in the invocation event give the same times as numbers", async () => {
  // The real service sends ISO strings in the invocation event and epoch seconds in
  // checkpoint responses. The in-memory service sends numbers in both. So this
  // service converts the event's timestamps to strings.
  const service = createInMemoryService();
  const event = service.event;
  service.event = () => {
    const e = event();
    for (const op of e.InitialExecutionState.Operations) {
      for (const key of ["StartTimestamp", "EndTimestamp"]) {
        if (typeof op[key] === "number") {
          op[key] = new Date(op[key] * 1000).toISOString();
        }
      }
    }
    return e;
  };
  const { records } = await run(threeSteps, {}, { service });
  const [record] = records;
  assert.equal(record.startTime, START_ISO);
  const [a, w, b] = record.operations;
  // a and w come from the event (strings). b comes from a checkpoint response (numbers).
  assert.equal(a.startTime, START_ISO);
  assert.equal(w.durationMs, 10_000);
  assert.equal(
    b.startTime,
    new Date((START_SECONDS + 10) * 1000).toISOString(),
  );
  assert.equal(b.durationMs, 0);
});

test("samplingRate 0 emits nothing; samplingRate 1 emits", async () => {
  const none = await run(threeSteps, { samplingRate: 0 });
  assert.equal(none.result.status, "SUCCEEDED");
  assert.deepEqual(none.records, []);
  const all = await run(threeSteps, { samplingRate: 1 });
  assert.equal(all.records.length, 1);
});

test("sampling compares the first 8 hex digits of sha256(arn) with the rate", () => {
  const hash = createHash("sha256").update(ARN).digest("hex");
  const fraction = Number.parseInt(hash.slice(0, 8), 16) / 2 ** 32;
  const info = { arn: ARN, input: {}, operations: [] };
  const exporters = [fakeExporter()];
  const below = createTelemetryPlugin({ exporters, samplingRate: fraction });
  const above = createTelemetryPlugin({
    exporters,
    samplingRate: fraction + 1e-9,
  });
  assert.equal(below(info), undefined);
  assert.ok(above(info));
});

test("onOperationChange exists only in on-change mode", () => {
  const info = { arn: ARN, input: {}, operations: [] };
  const exporters = [fakeExporter()];
  for (const emitMode of ["on-complete", "on-failure"]) {
    const plugin = createTelemetryPlugin({ exporters, emitMode })(info);
    assert.equal(plugin.onOperationChange, undefined);
  }
  const plugin = createTelemetryPlugin({ exporters, emitMode: "on-change" })(
    info,
  );
  assert.equal(typeof plugin.onOperationChange, "function");
});

test("failing, throwing and hanging exporters do not change the result", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const good = fakeExporter();
  const exporters = [
    { export: async () => Promise.reject(new Error("network down")) },
    {
      export: () => {
        throw new TypeError("sync throw");
      },
    },
    { export: () => new Promise(() => {}) },
    good,
  ];
  const started = Date.now();
  const result = await runDurable({
    workflow: threeSteps,
    plugins: [
      createTelemetryPlugin({
        exporters,
        emitMode: "on-change",
        exportTimeoutMs: 50,
      }),
    ],
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(result.result, { sum: 3 });
  assert.deepEqual(result.invocationErrors, []);
  // Two invocations, each bounded by 50 ms.
  assert.ok(Date.now() - started < 1000);
  const lines = warn.mock.calls.map((c) => c.arguments.join(" "));
  assert.ok(
    lines.some((l) => l.includes("export failed: Error: network down")),
  );
  assert.ok(
    lines.some((l) => l.includes("export failed: TypeError: sync throw")),
  );
  assert.ok(lines.some((l) => l.includes("did not finish within 50 ms")));
  for (const call of warn.mock.calls) {
    assert.equal(call.arguments.length, 1);
    assert.equal(call.arguments[0].includes("\n"), false);
  }
  // The hanging exporter blocks the chain of each invocation after its first record.
  // The good exporter still received the first record of each invocation.
  assert.equal(good.records.length, 2);
});

test("a record that cannot be built logs a warning and the workflow continues", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const exporter = fakeExporter();
  const plugin = createTelemetryPlugin({
    exporters: [exporter],
    emitMode: "on-change",
  });
  const p = plugin({ arn: ARN, input: {}, operations: [] });
  // A record whose getter throws makes buildRecord throw.
  const bad = {
    get Type() {
      throw new TypeError("bad record");
    },
  };
  assert.doesNotThrow(() => p.onOperationChange({ operations: [bad] }));
  await p.onInvocationEnd({
    status: "SUCCEEDED",
    result: 1,
    error: undefined,
    operations: [bad],
  });
  assert.equal(warn.mock.callCount(), 2);
  assert.equal(
    warn.mock.calls[0].arguments[0],
    "[durable-execution-telemetry] could not build the record: TypeError: bad record",
  );
  // The factory's record was built before the bad records arrived.
  assert.equal(exporter.records.length, 1);
});

test("on-change exports of one invocation run in order", async () => {
  const log = [];
  let n = 0;
  // Each export takes less time than the one before it. Without the chain, later
  // exports would finish first.
  const exporter = {
    async export(record) {
      const i = n++;
      log.push(`start ${i} ${record.status}`);
      await new Promise((resolve) => setTimeout(resolve, 30 - i * 5));
      log.push(`end ${i}`);
    },
  };
  await runDurable({
    workflow: async ({ ctx }) => {
      await ctx.step({ name: "a", fn: () => 1 });
      await ctx.step({ name: "b", fn: () => 2 });
    },
    plugins: [
      createTelemetryPlugin({ exporters: [exporter], emitMode: "on-change" }),
    ],
  });
  // Factory, the responses of a's and b's checkpoints, and the end: at least 3.
  assert.ok(n >= 3);
  assert.equal(log.length, 2 * n);
  for (let i = 0; i < n; i++) {
    assert.match(log[2 * i], new RegExp(`^start ${i} `));
    assert.equal(log[2 * i + 1], `end ${i}`);
  }
  assert.equal(log.at(-2), `start ${n - 1} SUCCEEDED`);
});

test("each exporter gets its own truncated copy", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const full = fakeExporter();
  const small = fakeExporter({ maxRecordBytes: 900 });
  const tiny = fakeExporter({ maxRecordBytes: 10 });
  await runDurable({
    workflow: async ({ ctx }) => {
      for (let i = 0; i < 5; i++)
        await ctx.step({ name: `s${i}`, fn: () => i });
      return "x".repeat(500);
    },
    input: { pad: "y".repeat(500) },
    plugins: [createTelemetryPlugin({ exporters: [full, small, tiny] })],
  });
  assert.equal(full.records[0].truncated, undefined);
  assert.equal(full.records[0].operations.length, 5);
  const cut = small.records[0];
  assert.equal(cut.truncated, true);
  assert.equal(cut.droppedInput, true);
  assert.equal(cut.droppedOutput, true);
  assert.ok(Buffer.byteLength(JSON.stringify(cut)) <= 900);
  assert.deepEqual(tiny.records, []);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    warn.mock.calls[0].arguments[0],
    /larger than 10 bytes after truncation/,
  );
});

test("both exporters receive the final record through the plugin", async () => {
  const { createCloudWatchLogsExporter } = await import(
    "../src/exporters/cloudwatch-logs.js"
  );
  const { createAuroraExporter } = await import("../src/exporters/aurora.js");
  const { fakeClient } = await import("./helpers.js");
  const logs = fakeClient();
  const rds = fakeClient();
  const result = await runDurable({
    workflow: threeSteps,
    plugins: [
      createTelemetryPlugin({
        exporters: [
          createCloudWatchLogsExporter({ logGroupName: "g", client: logs }),
          createAuroraExporter({
            resourceArn: "r",
            secretArn: "s",
            database: "d",
            client: rds,
          }),
        ],
      }),
    ],
  });
  assert.equal(result.status, "SUCCEEDED");
  const message = JSON.parse(logs.commands[1].input.logEvents[0].message);
  assert.equal(message.status, "SUCCEEDED");
  assert.deepEqual(Object.keys(message.operationsByName), ["a", "w", "b"]);
  const json = rds.commands[0].input.parameters.find(
    (p) => p.name === "record_json",
  );
  assert.equal(JSON.parse(json.value.stringValue).status, "SUCCEEDED");
});
