#!/usr/bin/env node
// Probes two MicroVMs service behaviors that the design depends on and the
// documentation does not settle:
//
// 1. Client token idempotency. Does a repeated RunMicrovm with the same token
//    return the same MicroVM? What happens with different parameters, and
//    after the first MicroVM is terminated?
// 2. The runHookPayload limit. The API reference says 4096 characters, and
//    the developer guide says 16 KB.
// 3. The unit of that limit. ASCII padding has one UTF-16 code unit per
//    UTF-8 byte, so it cannot tell bytes from characters. This probe pads
//    with "日" (1 unit, 3 bytes) and "😀" (2 units, 4 bytes) as well.
// 4. The answer of a dead MicroVM's endpoint (PROBES=dead only). It needs
//    an image with an HTTP worker on port 8080, such as the end-to-end image.
//
// Every MicroVM the probe starts is terminated before it exits.
//
// Usage: MICROVM_IMAGE_ARN=<arn> [PROBES=token,payload,unit] \
//   node e2e/probe-service.mjs

import { randomUUID } from "node:crypto";
import {
  CreateMicrovmAuthTokenCommand,
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

/**
 * A run hook payload of exactly `bytes` UTF-8 bytes. The padding is as many
 * copies of `char` as fit, and ASCII "x" fills the remainder.
 */
function payloadOfBytes(bytes, char) {
  const base = { version: 1, region: REGION, pad: "" };
  const overhead = Buffer.byteLength(JSON.stringify(base), "utf8");
  const room = bytes - overhead;
  const charBytes = Buffer.byteLength(char, "utf8");
  const copies = Math.floor(room / charBytes);
  const pad = char.repeat(copies) + "x".repeat(room - copies * charBytes);
  const text = JSON.stringify({ ...base, pad });
  if (Buffer.byteLength(text, "utf8") !== bytes) {
    throw new Error(`payloadOfBytes(${bytes}) built the wrong size`);
  }
  return text;
}

/**
 * A run hook payload of exactly `count` Unicode code points. The padding is
 * `char` only, so a 2-unit `char` makes the UTF-16 length much larger.
 */
function payloadOfCodePoints(count, char) {
  const base = { version: 1, region: REGION, pad: "" };
  const overhead = [...JSON.stringify(base)].length;
  const text = JSON.stringify({ ...base, pad: char.repeat(count - overhead) });
  if ([...text].length !== count) {
    throw new Error(`payloadOfCodePoints(${count}) built the wrong size`);
  }
  return text;
}

/** The three ways to count the length of a string. */
function measure(text) {
  return {
    utf16Units: text.length,
    codePoints: [...text].length,
    utf8Bytes: Buffer.byteLength(text, "utf8"),
  };
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
const probes = new Set((process.env.PROBES ?? "token,payload,unit").split(","));

// ---------------------------------------------------------------- 1. token
if (probes.has("token")) {
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
if (probes.has("payload")) {
  const sizes = [4_096, 4_097, 16_384, 16_385];
  results.runHookPayload = {};
  for (const size of sizes) {
    const outcome = await run(`probe-${randomUUID()}`, {
      runHookPayload: payload(size),
    });
    results.runHookPayload[size] = outcome.ok ? "accepted" : outcome.error;
  }
}

// ---------------------------------------------------------------- 3. unit
if (probes.has("unit")) {
  // Each case is accepted under one counting rule and rejected under another.
  const cases = [
    // At most 4,096 units, more than 4,096 bytes.
    ["cjk-5658-bytes", payloadOfBytes(5_658, "日")],
    ["cjk-12288-bytes", payloadOfBytes(12_288, "日")],
    // Exactly at, and one past, 16,384 bytes. Both are far below 16,384 units.
    ["cjk-16384-bytes", payloadOfBytes(16_384, "日")],
    ["cjk-16385-bytes", payloadOfBytes(16_385, "日")],
    // 😀 is 2 units and 1 code point, so this separates units from code points.
    ["emoji-16384-bytes", payloadOfBytes(16_384, "😀")],
    ["emoji-16385-bytes", payloadOfBytes(16_385, "😀")],
    // At and one past 4,096 code points. Both are about 8,170 units.
    ["emoji-4096-code-points", payloadOfCodePoints(4_096, "😀")],
    ["emoji-4097-code-points", payloadOfCodePoints(4_097, "😀")],
    ["cjk-4096-code-points", payloadOfCodePoints(4_096, "日")],
  ];
  results.runHookPayloadUnit = {};
  for (const [label, text] of cases) {
    const outcome = await run(`probe-${randomUUID()}`, {
      runHookPayload: text,
    });
    results.runHookPayloadUnit[label] = {
      ...measure(text),
      outcome: outcome.ok ? "accepted" : outcome.error,
    };
  }
}

// ---------------------------------------------------------------- 4. dead
// What does the endpoint of a MicroVM answer once the MicroVM ends? And does
// CreateMicrovmAuthToken still issue a token for it? The probe asks both
// while the MicroVM runs, right after TerminateMicrovm, and once GetMicrovm
// reports TERMINATED.
if (probes.has("dead")) {
  const launched = await client.send(
    new RunMicrovmCommand({
      imageIdentifier: IMAGE,
      clientToken: `probe-${randomUUID()}`,
      ingressNetworkConnectors: [connector("ALL_INGRESS")],
      egressNetworkConnectors: [connector("INTERNET_EGRESS")],
      maximumDurationInSeconds: 600,
      runHookPayload: payload(100),
    }),
  );
  started.add(launched.microvmId);
  const id = launched.microvmId;
  const url = `https://${launched.endpoint.replace(/^https?:\/\//, "")}/durable-execution/v1/job`;
  const state = async () =>
    client.send(new GetMicrovmCommand({ microvmIdentifier: id }));
  const ask = async () => {
    let token;
    try {
      token = (
        await client.send(
          new CreateMicrovmAuthTokenCommand({
            microvmIdentifier: id,
            expirationInMinutes: 5,
            allowedPorts: [{ port: 8080 }],
          }),
        )
      ).authToken;
    } catch (error) {
      return { token: `${error.name}: ${error.message}` };
    }
    const at = Date.now();
    try {
      // An empty job body: the worker answers 400, so a 400 means that the
      // request reached the worker.
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...token },
        body: "{}",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      return {
        token: "issued",
        status: response.status,
        headers: Object.fromEntries(
          [...response.headers].filter(([name]) => !/^date$/i.test(name)),
        ),
        body: (await response.text()).slice(0, 500),
        ms: Date.now() - at,
      };
    } catch (error) {
      return {
        token: "issued",
        fetchError: `${error.name}: ${error.cause?.code ?? error.message}`,
        ms: Date.now() - at,
      };
    }
  };
  for (let i = 0; i < 60 && (await state()).state !== "RUNNING"; i++) {
    await sleep(2_000);
  }
  const running = await ask();
  await client.send(new TerminateMicrovmCommand({ microvmIdentifier: id }));
  const afterTerminate = { state: (await state()).state, ...(await ask()) };
  let last;
  for (let i = 0; i < 60; i++) {
    last = await state();
    if (last.state === "TERMINATED") {
      break;
    }
    await sleep(2_000);
  }
  const terminated = {
    state: last.state,
    stateReason: last.stateReason,
    ...(await ask()),
  };
  await sleep(30_000);
  const terminated30s = { state: (await state()).state, ...(await ask()) };
  results.deadMicrovm = { running, afterTerminate, terminated, terminated30s };
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
