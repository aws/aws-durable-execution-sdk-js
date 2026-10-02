#!/usr/bin/env node
// Probes two MicroVMs service behaviors that the design depends on and the
// documentation does not settle:
//
// 1. Client token idempotency. Does a repeated RunMicrovm with the same token
//    return the same MicroVM? What happens with different parameters, and
//    after the first MicroVM is terminated?
// 2. The runHookPayload limit. The API reference says 4096 characters, and
//    the developer guide says 16 KB.
//
// Every MicroVM the probe starts is terminated before it exits.
//
// Usage: MICROVM_IMAGE_ARN=<arn> node e2e/probe-service.mjs

import { randomUUID } from "node:crypto";
import {
  GetMicrovmCommand,
  LambdaMicrovmsClient,
  RunMicrovmCommand,
  TerminateMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const IMAGE = process.env.MICROVM_IMAGE_ARN;
if (!IMAGE) {
  throw new Error("MICROVM_IMAGE_ARN is not set");
}
const client = new LambdaMicrovmsClient({ region: REGION });
const connector = (name) =>
  `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:${name}`;
const started = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A run hook payload that the worker accepts: it has no job. */
function payload(length) {
  const base = { version: 1, region: REGION, pad: "" };
  const overhead = JSON.stringify(base).length;
  return JSON.stringify({
    ...base,
    pad: "x".repeat(Math.max(0, length - overhead)),
  });
}

async function run(clientToken, overrides = {}) {
  try {
    const response = await client.send(
      new RunMicrovmCommand({
        imageIdentifier: IMAGE,
        clientToken,
        ingressNetworkConnectors: [connector("NO_INGRESS")],
        egressNetworkConnectors: [connector("INTERNET_EGRESS")],
        maximumDurationInSeconds: 600,
        runHookPayload: payload(100),
        ...overrides,
      }),
    );
    started.add(response.microvmId);
    return { ok: true, microvmId: response.microvmId, state: response.state };
  } catch (error) {
    return { ok: false, error: `${error.name}: ${error.message}` };
  }
}

async function terminateAndWait(microvmId) {
  await client.send(
    new TerminateMicrovmCommand({ microvmIdentifier: microvmId }),
  );
  for (let i = 0; i < 60; i++) {
    const vm = await client.send(
      new GetMicrovmCommand({ microvmIdentifier: microvmId }),
    );
    if (vm.state === "TERMINATED") {
      return;
    }
    await sleep(2_000);
  }
  throw new Error(`${microvmId} did not reach TERMINATED`);
}

const results = {};

// ---------------------------------------------------------------- 1. token
{
  const token = `probe-${randomUUID()}`;
  const first = await run(token);
  const repeat = await run(token);
  const differentParams = await run(token, { maximumDurationInSeconds: 900 });
  if (first.ok) {
    await terminateAndWait(first.microvmId);
  }
  const afterTerminate = await run(token);
  results.clientToken = {
    first,
    repeatSameParams: repeat,
    repeatDifferentParams: differentParams,
    repeatAfterFirstTerminated: afterTerminate,
    sameMicrovmOnRepeat:
      first.ok && repeat.ok && first.microvmId === repeat.microvmId,
    sameMicrovmAfterTerminate:
      first.ok &&
      afterTerminate.ok &&
      first.microvmId === afterTerminate.microvmId,
  };
}

// ---------------------------------------------------------------- 2. payload
{
  const sizes = [4_096, 4_097, 16_384, 16_385];
  results.runHookPayload = {};
  for (const size of sizes) {
    const outcome = await run(`probe-${randomUUID()}`, {
      runHookPayload: payload(size),
    });
    results.runHookPayload[size] = outcome.ok ? "accepted" : outcome.error;
  }
}

// ---------------------------------------------------------------- cleanup
for (const id of started) {
  try {
    await client.send(new TerminateMicrovmCommand({ microvmIdentifier: id }));
  } catch (error) {
    console.error(`terminate ${id}: ${error.name}`);
  }
}
results.startedMicrovms = [...started];
console.log(JSON.stringify(results, null, 2));
