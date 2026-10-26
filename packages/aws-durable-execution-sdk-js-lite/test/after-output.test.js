import assert from "node:assert/strict";
import { test } from "node:test";
import { withDurableExecution } from "../src/index.js";
import { createFakeClient, event, executionOp } from "./helpers/fake-client.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The workflow returns when the fast branch of a Promise.race inside a child context
// wins. The losing branch still runs a slow step. After the slow step, it calls a
// later step. Both settle after the handler returned.
async function raceWithLosingBranch({ plugins, later = () => {} }) {
  const client = createFakeClient({ operations: [executionOp()] });
  const handler = withDurableExecution(
    async ({ ctx }) =>
      ctx.runInChildContext({
        name: "race",
        fn: ({ ctx: child }) =>
          Promise.race([
            child.step({ name: "fast", fn: () => "fast" }),
            (async () => {
              await child.step({ name: "slow", fn: () => sleep(30) });
              return child.step({ name: "later", fn: later });
            })(),
          ]),
      }),
    { client, plugins },
  );
  const output = await handler(event(), {});
  const requestsAtOutput = client.checkpoints.length;
  // The slow step's fn settles 30 ms after it started.
  await sleep(100);
  return { output, client, requestsAtOutput };
}

test("no checkpoint and no onOperationChange after the output is decided", async () => {
  const log = [];
  const plugin = () => ({
    onOperationChange: () => log.push("change"),
    onInvocationEnd: () => log.push("end"),
  });
  const { output, client, requestsAtOutput } = await raceWithLosingBranch({
    plugins: [plugin],
  });
  assert.deepEqual(output, { Status: "SUCCEEDED", Result: '"fast"' });
  assert.deepEqual(
    {
      requests: client.checkpoints.length,
      hooksAfterEnd: log.slice(log.indexOf("end") + 1),
    },
    { requests: requestsAtOutput, hooksAfterEnd: [] },
  );
});

test("a step does not run fn after the handler returned SUCCEEDED", async () => {
  let ran = false;
  const { output } = await raceWithLosingBranch({
    later: () => {
      ran = true;
    },
  });
  assert.equal(output.Status, "SUCCEEDED");
  assert.equal(ran, false);
});
