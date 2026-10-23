// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { routeExample } from "./routing.mjs";
import sharedModule from "../packages/aws-durable-execution-sdk-js-examples/src/utils/shared-lmi.ts";
const { wrapLmiPayload } = sharedModule;

for (const input of [{ value: "input" }, [1, 2], "text", null]) {
  test(`shared route preserves payload ${JSON.stringify(input)} and replay checkpoints`, () => {
    const payload = wrapLmiPayload(
      Buffer.from(JSON.stringify(input)),
      "step-basic",
      "case",
      "run",
    );
    const operation = {
      Id: "step",
      Type: "STEP",
      Status: "SUCCEEDED",
      StepDetails: { Result: '"stored"' },
    };
    const event = {
      CheckpointToken: "token",
      InitialExecutionState: {
        Operations: [
          {
            Id: "execution",
            Type: "EXECUTION",
            ExecutionDetails: { InputPayload: Buffer.from(payload).toString() },
          },
          operation,
        ],
      },
    };
    const original = structuredClone(event);
    const handler = () => undefined;
    const route = routeExample(event, { "step-basic": handler });
    assert.equal(route.handler, handler);
    assert.deepEqual(
      JSON.parse(
        route.event.InitialExecutionState.Operations[0].ExecutionDetails
          .InputPayload,
      ),
      input,
    );
    assert.equal(route.event.InitialExecutionState.Operations[1], operation);
    assert.equal(route.event.CheckpointToken, "token");
    assert.deepEqual(event, original);
  });
}

test("unknown inherited handler names cannot be dispatched", () => {
  const payload = wrapLmiPayload(undefined, "constructor", "case", "run");
  const event = {
    InitialExecutionState: {
      Operations: [
        {
          Type: "EXECUTION",
          ExecutionDetails: { InputPayload: Buffer.from(payload).toString() },
        },
      ],
    },
  };
  assert.throws(() => routeExample(event, {}), /Unknown LMI example handler/);
});

for (const exitCode of [0, 9]) {
  test(`stalled settlement blocks later cases (${exitCode === 0 ? "success" : "failure"})`, async () => {
    const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } =
      await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const directory = mkdtempSync(path.join(tmpdir(), "lmi-settle-test-"));
    const { setTimeout: delay } = await import("node:timers/promises");
    const script = path.join(directory, "settle.cjs");
    const quarantine = path.join(directory, "quarantine.json");
    const started = path.join(directory, "started");
    const release = path.join(directory, "release");
    writeFileSync(
      script,
      `const fs = require("node:fs");
fs.appendFileSync("started", "start\\n");
setInterval(() => {
  if (fs.existsSync("release")) process.exit(${exitCode});
}, 10);
`,
    );
    const settings = {
      LMI_SHARED_EXAMPLES: "1",
      LMI_RUN_ID: "run",
      LMI_CONTROL_SCRIPT: script,
      LMI_REPO_ROOT: directory,
      LMI_QUARANTINE_FILE: quarantine,
      LMI_PYTHON: process.execPath,
    };
    const previous = Object.fromEntries(
      Object.keys(settings).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, settings);
    writeFileSync(
      path.join(directory, "manifest.json"),
      JSON.stringify({
        run: "run",
        commit: "commit",
        functions: { shared: "function" },
      }),
    );
    let settlement;
    let repeatedSettlement;
    try {
      let factory;
      const fakeClient = {
        middlewareStack: {
          add(value) {
            factory = value;
          },
        },
      };
      const hooks = sharedModule.sharedLmi(fakeClient, "step-basic");
      let invocations = 0;
      const next = async () => {
        invocations++;
        return { output: {} };
      };
      const invoke = factory(next, { commandName: "InvokeCommand" });
      hooks.before();
      const input = { FunctionName: "function" };
      await invoke({ input });
      settlement = hooks.after();
      let settled = false;
      settlement.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      // The gate must close before after() yields, even if Jest stops awaiting it.
      assert(existsSync(quarantine));
      assert.deepEqual(JSON.parse(readFileSync(quarantine, "utf8")), {
        run: "run",
        markers: [input.DurableExecutionName],
        state: "settling",
      });
      assert.throws(hooks.before, /quarantined/);
      await assert.rejects(invoke({ input: {} }), /quarantined/);
      const later = sharedModule.sharedLmi(fakeClient, "wait");
      const laterInvoke = factory(next, { commandName: "InvokeCommand" });
      assert.throws(later.before, /quarantined/);
      await assert.rejects(laterInvoke({ input: {} }), /quarantined/);

      const deadline = Date.now() + 5000;
      while (!existsSync(started) && Date.now() < deadline) await delay(10);
      assert(existsSync(started), "settlement subprocess started");
      const childStarts = () =>
        readFileSync(started, "utf8").trim().split("\n").length;
      assert.equal(childStarts(), 1);
      // A timed-out afterEach is followed by a failing beforeEach and another
      // afterEach on these same hooks, while the original child is still pending.
      assert.throws(hooks.before, /quarantined/);
      repeatedSettlement = hooks.after();
      const outcomes = Promise.allSettled([settlement, repeatedSettlement]);
      assert(existsSync(quarantine));
      assert.throws(later.before, /quarantined/);
      await assert.rejects(laterInvoke({ input: {} }), /quarantined/);
      assert.equal(settled, false, "settlement is still waiting for release");
      assert.equal(
        invocations,
        1,
        "blocked invocations never reach the client",
      );

      writeFileSync(release, "");
      const results = await outcomes;
      assert.equal(
        childStarts(),
        1,
        "repeated hooks share one settlement child",
      );
      if (exitCode === 0) {
        assert.deepEqual(results, [
          { status: "fulfilled", value: undefined },
          { status: "fulfilled", value: undefined },
        ]);
        assert(!existsSync(quarantine));
        hooks.before();
        later.before();
        await invoke({ input: { FunctionName: "function" } });
        assert.equal(invocations, 2);
        await hooks.after();
        assert.equal(childStarts(), 2, "the next case gets a new settlement");
        assert(!existsSync(quarantine));
      } else {
        assert.equal(results[0].status, "rejected");
        assert.equal(results[1].status, "rejected");
        assert.equal(results[0].reason, results[1].reason);
        assert(existsSync(quarantine));
        const record = JSON.parse(readFileSync(quarantine, "utf8"));
        assert.equal(record.run, "run");
        assert.deepEqual(record.markers, [input.DurableExecutionName]);
        assert.match(record.error, /Command failed/);
        assert.throws(later.before, /quarantined/);
        await assert.rejects(laterInvoke({ input: {} }), /quarantined/);
        assert.equal(invocations, 1);
      }
    } finally {
      writeFileSync(release, "");
      await Promise.allSettled([settlement, repeatedSettlement]);
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("example invocation intent is durable before submission and retains the response ARN", async () => {
  const { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const directory = mkdtempSync(path.join(tmpdir(), "lmi-intent-test-"));
  const settings = {
    LMI_SHARED_EXAMPLES: "1",
    LMI_RUN_ID: "run",
    LMI_CONTROL_SCRIPT: "unused.py",
    LMI_REPO_ROOT: directory,
    LMI_QUARANTINE_FILE: path.join(directory, "quarantine.json"),
  };
  const previous = Object.fromEntries(
    Object.keys(settings).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, settings);
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = {
    run: "run",
    commit: "commit",
    functions: { shared: "function" },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  try {
    let factory;
    const client = {
      middlewareStack: {
        add(value) {
          factory = value;
        },
      },
    };
    for (const invalid of [
      null,
      { ...manifest, run: "different" },
      { ...manifest, commit: "" },
      { ...manifest, functions: {} },
    ]) {
      writeFileSync(manifestPath, JSON.stringify(invalid));
      assert.throws(
        () => sharedModule.sharedLmi(client, "step-basic"),
        /manifest/,
      );
    }
    writeFileSync(manifestPath, "{");
    assert.throws(
      () => sharedModule.sharedLmi(client, "step-basic"),
      SyntaxError,
    );
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const hooks = sharedModule.sharedLmi(client, "step-basic");
    const read = (marker) =>
      JSON.parse(
        readFileSync(
          path.join(directory, "invocations", `${marker}.json`),
          "utf8",
        ),
      );
    const response = {
      output: {
        DurableExecutionArn: "accepted",
        $metadata: { requestId: "request" },
      },
    };
    let calls = 0;
    const invoke = factory(
      async ({ input }) => {
        calls++;
        const intent = read(input.DurableExecutionName);
        assert.equal(intent.run, "run");
        assert.equal(intent.commit, "commit");
        assert.equal(intent.invoked, true);
        assert.deepEqual(intent.gates, {});
        assert.equal(intent.arn, undefined);
        return response;
      },
      { commandName: "InvokeCommand" },
    );
    hooks.before();
    writeFileSync(path.join(directory, "invocations"), "blocked");
    await assert.rejects(invoke({ input: { FunctionName: "function" } }), {
      code: "EEXIST",
    });
    assert.equal(calls, 0, "A failed intent write must not submit Invoke");
    unlinkSync(path.join(directory, "invocations"));
    await assert.rejects(
      invoke({ input: { FunctionName: "different" } }),
      /different function/,
    );
    assert.equal(calls, 0);
    const input = { FunctionName: "function" };
    assert.equal(await invoke({ input }), response);
    const saved = read(input.DurableExecutionName);
    assert.equal(saved.arn, "accepted");
    assert.equal(saved.invokeRequestId, "request");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
