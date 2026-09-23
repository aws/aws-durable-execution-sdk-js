// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { threadId } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { LambdaClient } from "@aws-sdk/client-lambda";
import {
  withDurableExecution,
  DurableExecutionApiClient,
} from "@aws/durable-execution-sdk-js";
import { workflow } from "./scenarios.mjs";
import { observer } from "./observer.mjs";

// /tmp is shared by Node workers in one environment; worker UUID distinguishes
// reused thread IDs. Exclusive creation also handles simultaneous cold workers.
const environmentFile = "/tmp/js-lmi-environment";
try {
  writeFileSync(environmentFile, randomUUID(), { flag: "wx" });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
const environment = readFileSync(environmentFile, "utf8");
const worker = randomUUID();
let sequence = 0;
const tracker = observer();
const s3 = new S3Client({ maxAttempts: 2 });
const lambda = new LambdaClient({ maxAttempts: 1 });
const transport = new DurableExecutionApiClient(lambda);
const bucket = process.env.LMI_BUCKET;
const run = process.env.LMI_RUN_ID;
const hash = (value) =>
  createHash("sha256")
    .update(value ?? "")
    .digest("hex");

function trace(state, phase, fields = {}) {
  return tracker.outside(async () => {
    const seq = ++sequence;
    const record = {
      run,
      commit: process.env.LMI_COMMIT,
      marker: state.event.marker,
      execution: state.execution,
      request: state.request,
      environment,
      worker,
      pid: process.pid,
      threadId,
      seq,
      time: Date.now() / 1000,
      deadline: state.deadline,
      phase,
      ...fields,
    };
    // Persist before signalling a gate or returning a transport result. Sequence
    // belongs to this worker; S3 object keys prevent retry requests overwriting it.
    console.log(JSON.stringify({ lmi: record }));
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `events/${state.event.marker}/${worker}/${state.request}/${String(seq).padStart(10, "0")}.json`,
        Body: JSON.stringify(record),
        ContentType: "application/json",
      }),
    );
  });
}
async function hold(state, gate, onEnter) {
  return tracker.outside(async () => {
    const key = `control/${state.event.gates[gate]}`;
    const read = async () => {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return response.Body.transformToString();
    };
    try {
      const initial = await read();
      if (
        initial === "release" &&
        state.event.scenario === "deadline-step" &&
        gate === "loser"
      ) {
        // A real service retry can enter after the driver released interrupted
        // I/O. Admission still requires BLOCKED from the original request; this
        // retry must not invent a second hold or overwrite the released latch.
        await trace(state, "ALREADY_RELEASED", { gate });
        return;
      }
      if (initial !== "hold")
        throw new Error(`Fixture gate was not held: ${gate}`);
      await trace(state, "BLOCKED", { gate });
      onEnter?.();
      const escapeDeadline = Date.now() + 120000;
      while (true) {
        const value = await read();
        if (value === "release") break;
        if (value !== "hold")
          throw new Error(`Invalid fixture control: ${gate}`);
        const emergency = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: "control/release-all" }),
        );
        if (
          (await emergency.Body.transformToString()) === "release" ||
          Date.now() > escapeDeadline
        ) {
          await trace(state, "ESCAPE", { gate });
          throw new Error(`Fixture escape: ${gate}`);
        }
        await trace(state, "ALIVE", { gate });
        await delay(500);
      }
      await trace(state, "RELEASED", { gate });
    } catch (error) {
      await trace(state, "FIXTURE_ERROR", { gate, error: error.name });
      throw error;
    }
  });
}
function current() {
  const state = tracker.scope.getStore();
  if (!state) throw new Error("Invocation context lost in shared client");
  return state;
}
// Record real AWS sends separately from calls into the SDK client. In-flight
// checkpoint cases hold a genuine service response, not a fake checkpoint.
lambda.middlewareStack.add(
  (next, context) => async (args) => {
    const state = current();
    await trace(state, "SEND", {
      command: context.commandName,
      closed: state.closed,
    });
    return tracker.outside(() => next(args));
  },
  { step: "initialize", name: "lmiTransportObservation" },
);

const client = {
  async checkpoint(request, logger) {
    const state = current();
    const updates = (request.Updates ?? []).map(
      ({ Id, ParentId, Name, Type, Action }) => ({
        Id,
        ParentId,
        Name,
        Type,
        Action,
      }),
    );
    await trace(state, "CHECKPOINT", {
      updates,
      token: hash(request.CheckpointToken),
      target: request.DurableExecutionArn,
      closed: state.closed,
    });
    const response = await transport.checkpoint(request, logger);
    await trace(state, "CHECKPOINT_SETTLED", { updates });
    if (
      state.event.scenario === "deadline-checkpoint" &&
      updates.some((u) => u.Name === "blocked" && u.Action === "SUCCEED")
    ) {
      await hold(state, "transport");
    }
    return response;
  },
  async getExecutionState(request, logger) {
    const state = current();
    await trace(state, "POLL", {
      token: hash(request.CheckpointToken),
      target: request.DurableExecutionArn,
      closed: state.closed,
    });
    return transport.getExecutionState(request, logger);
  },
};

// One decorated handler and one AWS client are shared by every concurrent root.
const durable = withDurableExecution(
  async (event, ctx) => {
    const state = current();
    const io = {
      record: (phase, fields) => trace(state, phase, fields),
      hold: (gate, entered) => hold(state, gate, entered),
    };
    try {
      return await workflow(event, ctx, io);
    } finally {
      await trace(state, "ROOT_FINALLY");
    }
  },
  { durableExecutionClient: client },
);

export async function handler(event, context) {
  const input = JSON.parse(
    event.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload,
  );
  const state = {
    kind: "sdk",
    event: input,
    request: context.awsRequestId,
    execution: event.DurableExecutionArn,
    deadline: (Date.now() + context.getRemainingTimeInMillis()) / 1000,
    closed: false,
    lateCallbacks: 0,
  };
  await trace(state, "ENTER");
  try {
    const response = await tracker.scope.run(state, () =>
      durable(event, context),
    );
    state.closed = true;
    await trace(state, "RETURN", {
      status: response.Status,
      resources: tracker.snapshot(state),
    });
    return response;
  } catch (error) {
    state.closed = true;
    await trace(state, "RAISE", {
      error: error.name,
      resources: tracker.snapshot(state),
    });
    throw error;
  } finally {
    // Observation, not cleanup: never abort user work, clear SDK timers, or
    // destroy a shared client here. A live companion keeps this worker active.
    tracker.outside(() => {
      const timer = setTimeout(() => {
        trace(state, "OBSERVED", { resources: tracker.snapshot(state) }).catch(
          (error) => console.error("LMI evidence write failed", error.name),
        );
      }, 1000);
      timer.unref();
    });
  }
}
