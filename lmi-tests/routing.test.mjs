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

test("failed settlement quarantines subsequent example cases", async () => {
  const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import(
    "node:fs"
  );
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const directory = mkdtempSync(path.join(tmpdir(), "lmi-settle-test-"));
  const script = path.join(directory, "fail.cjs");
  const quarantine = path.join(directory, "quarantine.json");
  writeFileSync(script, "process.exit(9)");
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
    hooks.before();
    await factory(async () => ({ output: {} }), {
      commandName: "InvokeCommand",
    })({ input: {} });
    await assert.rejects(hooks.after());
    assert(existsSync(quarantine));
    assert.throws(hooks.before, /quarantined/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
