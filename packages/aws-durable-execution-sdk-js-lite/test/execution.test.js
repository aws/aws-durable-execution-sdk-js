import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, createExecution } from "../src/execution.js";
import { ARN, createFakeClient, httpError } from "./helpers/fake-client.js";

const tick = () => new Promise((r) => setImmediate(r));
const make = (client, operations = []) =>
  createExecution({ client, arn: ARN, token: "token-0", operations });
const update = (Id, Action = "START") => ({ Id, Type: "STEP", Action });

test("updates of one tick go in one request with the current token", async () => {
  const client = createFakeClient();
  const ex = make(client);
  await Promise.all([ex.checkpoint(update("a")), ex.checkpoint(update("b"))]);
  await ex.checkpoint(update("c"));
  assert.deepEqual(
    client.checkpoints.map((r) => [
      r.CheckpointToken,
      r.Updates.map((u) => u.Id),
    ]),
    [
      ["token-0", ["a", "b"]],
      ["token-1", ["c"]],
    ],
  );
  assert.equal(client.checkpoints[0].DurableExecutionArn, ARN);
});

test("updates queued while a request is in flight go together in the next one", async () => {
  const client = createFakeClient();
  const ex = make(client);
  const release = client.hold();
  const first = ex.checkpoint(update("a"));
  await tick();
  assert.equal(client.checkpoints.length, 1);
  const rest = [ex.checkpoint(update("b")), ex.checkpoint(update("c"))];
  await tick();
  assert.equal(client.checkpoints.length, 1, "only one request in flight");
  release();
  await Promise.all([first, ...rest]);
  assert.deepEqual(
    client.checkpoints[1].Updates.map((u) => u.Id),
    ["b", "c"],
  );
  assert.equal(client.checkpoints[1].CheckpointToken, "token-1");
});

test("a request carries at most 250 updates", async () => {
  const client = createFakeClient();
  const ex = make(client);
  const all = [];
  for (let i = 0; i < 260; i++) all.push(ex.checkpoint(update(`id${i}`)));
  await Promise.all(all);
  assert.deepEqual(
    client.checkpoints.map((r) => r.Updates.length),
    [250, 10],
  );
});

test("a request stays within 750 KiB, in order", async () => {
  const client = createFakeClient();
  const ex = make(client);
  const big = (Id, kib) => ({
    ...update(Id, "SUCCEED"),
    Payload: "x".repeat(kib * 1024),
  });
  const all = [];
  for (let i = 0; i < 6; i++) all.push(ex.checkpoint(big(`b${i}`, 200)));
  await Promise.all(all);
  assert.deepEqual(
    client.checkpoints.map((r) => r.Updates.map((u) => u.Id)),
    [
      ["b0", "b1", "b2"],
      ["b3", "b4", "b5"],
    ],
  );
  for (const r of client.checkpoints) {
    assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 750 * 1024);
  }
});

test("an update larger than 750 KiB goes alone", async () => {
  const client = createFakeClient();
  const ex = make(client);
  await Promise.all([
    ex.checkpoint(update("a")),
    ex.checkpoint({
      ...update("huge", "SUCCEED"),
      Payload: "x".repeat(800 * 1024),
    }),
    ex.checkpoint(update("b")),
  ]);
  assert.deepEqual(
    client.checkpoints.map((r) => r.Updates.map((u) => u.Id)),
    [["a"], ["huge"], ["b"]],
  );
});

test("NewExecutionState replaces operations by Id", async () => {
  const client = createFakeClient();
  client.script({
    CheckpointToken: "t",
    NewExecutionState: {
      Operations: [{ Id: "a", Status: "SUCCEEDED" }, { Id: "new" }],
    },
  });
  const ex = make(client, [{ Id: "a", Status: "STARTED", Extra: 1 }]);
  await ex.checkpoint(update("a"));
  assert.deepEqual(ex.get("a"), { Id: "a", Status: "SUCCEEDED" });
  assert.deepEqual(ex.get("new"), { Id: "new" });
  await ex.checkpoint(update("b"));
  assert.equal(client.checkpoints[1].CheckpointToken, "t");
});

test("a response without a token suspends and never resolves the callers", async () => {
  const client = createFakeClient();
  client.script({ NewExecutionState: { Operations: [{ Id: "a" }] } });
  const ex = make(client);
  let resolved = false;
  void ex.checkpoint(update("a")).then(() => {
    resolved = true;
  });
  assert.deepEqual(await ex.terminated, { kind: "pending" });
  await tick();
  assert.equal(resolved, false);
  assert.equal(
    ex.get("a"),
    undefined,
    "state of a revoked response is ignored",
  );
  // Later checkpoints are not sent.
  void ex.checkpoint(update("b"));
  await tick();
  assert.equal(client.checkpoints.length, 1);
});

test("no token after an EXECUTION update is success", async () => {
  const client = createFakeClient();
  client.script({});
  const ex = make(client);
  await ex.checkpoint({ Id: "x", Type: "EXECUTION", Action: "SUCCEED" });
});

test("checkpoint errors are classified per AGENTS.md 2.8", () => {
  const token = httpError(
    400,
    "InvalidParameterValueException",
    "Invalid checkpoint token: stale",
  );
  assert.equal(classify(token).kind, "throw");
  assert.equal(
    classify(httpError(400, "InvalidParameterValueException")).kind,
    "failed",
  );
  assert.equal(
    classify(httpError(403, "AccessDeniedException")).kind,
    "failed",
  );
  assert.equal(classify(httpError(502, "KMSDisabledException")).kind, "failed");
  assert.equal(
    classify(httpError(429, "TooManyRequestsException")).kind,
    "throw",
  );
  assert.equal(classify(httpError(500, "ServiceException")).kind, "throw");
  assert.equal(classify(new TypeError("fetch failed")).kind, "throw");
});

test("a failed checkpoint terminates with the classified outcome", async () => {
  const client = createFakeClient();
  const err = httpError(400, "ValidationException");
  client.script(err);
  const ex = make(client);
  void ex.checkpoint(update("a"));
  assert.deepEqual(await ex.terminated, { kind: "failed", error: err });
});

test("blocked with nothing running or pending suspends", async () => {
  const ex = make(createFakeClient());
  void ex.block();
  assert.deepEqual(await ex.terminated, { kind: "pending" });
});

test("a running operation prevents suspension", async () => {
  const ex = make(createFakeClient());
  let outcome;
  void ex.terminated.then((o) => {
    outcome = o;
  });
  ex.runningStart();
  void ex.block();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(outcome, undefined);
  ex.runningEnd();
  assert.deepEqual(await ex.terminated, { kind: "pending" });
});

test("a pending checkpoint prevents suspension until it is saved", async () => {
  const client = createFakeClient();
  const ex = make(client);
  const release = client.hold();
  void ex.checkpoint(update("a"));
  void ex.block();
  let outcome;
  void ex.terminated.then((o) => {
    outcome = o;
  });
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(outcome, undefined);
  release();
  assert.deepEqual(await ex.terminated, { kind: "pending" });
});
