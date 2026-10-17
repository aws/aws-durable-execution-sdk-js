// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { setTimeout as delay } from "node:timers/promises";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { workflow, deferred } from "./scenarios.mjs";
function invocation(scenario, overrides = {}) {
  const marker = overrides.marker ?? scenario;
  return {
    DurableExecutionArn: `arn:aws:lambda:us-west-2:123456789012:function:lmi:1/durable-execution/${marker}/test`,
    CheckpointToken: `token-${marker}`,
    InitialExecutionState: {
      Operations: [
        {
          Id: "execution",
          Type: "EXECUTION",
          Status: "STARTED",
          StartTimestamp: new Date("2026-09-23T00:00:00Z"),
          ExecutionDetails: {
            InputPayload: JSON.stringify({ scenario, marker }),
          },
        },
        ...(overrides.operations ?? []),
      ],
    },
  };
}
function harness(scenario) {
  const events = [];
  const calls = [];
  const gates = Object.fromEntries(
    ["peer", "loser", "winner"].map((key) => [key, deferred()]),
  );
  const entered = deferred();
  let remaining = 60000;
  let closed = false;
  const io = {
    async record(phase, fields = {}) {
      events.push({ phase, ...fields, closed });
    },
    async hold(key, onEnter) {
      if (key === "loser" || key === "peer") {
        onEnter?.();
        entered.resolve();
      }
      await gates[key].promise;
    },
  };
  const client = {
    async getExecutionState() {
      return { Operations: [] };
    },
    async checkpoint(request) {
      calls.push({ ...structuredClone(request), closed });
      return { CheckpointToken: request.CheckpointToken };
    },
  };
  const handler = withDurableExecution(
    (event, ctx) => workflow(event, ctx, io),
    { durableExecutionClient: client },
  );
  return {
    events,
    calls,
    gates,
    entered,
    client,
    handler,
    expire() {
      remaining = -1;
    },
    run(input = invocation(scenario)) {
      return handler(input, {
        awsRequestId: `request-${scenario}`,
        getRemainingTimeInMillis: () => remaining,
      }).finally(() => {
        closed = true;
      });
    },
    release() {
      for (const gate of Object.values(gates)) gate.resolve();
    },
  };
}
async function bounded(promise) {
  return Promise.race([
    promise,
    delay(3000, undefined, { ref: false }).then(() => {
      throw new Error("Fixture did not settle");
    }),
  ]);
}

export { invocation, harness, bounded };
