#!/usr/bin/env node
// Probes when and how Lambda calls the suspend and terminate lifecycle
// hooks. The worker's handling of those hooks depends on these behaviors,
// and the documentation does not settle them:
//
// 1. Which events call the terminate hook: TerminateMicrovm on a running
//    MicroVM, the end of maximumDurationInSeconds, and TerminateMicrovm on
//    a suspended MicroVM.
// 2. Which events call the suspend hook: SuspendMicrovm from outside,
//    SuspendMicrovm from inside the MicroVM, and the idle policy.
// 3. Whether the network and the credentials work during the hook, and
//    whether Lambda waits for the hook's answer before it acts.
// 4. Which Host and x-amzn-requestid headers Lambda's hook calls carry.
//
// The image runs e2e/lifecycle-probe-app.mjs, which logs every request. The
// probe reads those lines from the MicroVM's log stream. Every MicroVM the
// probe starts is terminated before it exits.
//
// Usage: AWS_REGION=us-east-1 node e2e/probe-lifecycle.mjs
//   [PROBE_SCENARIOS=terminate,max-duration,suspend-resume,...]

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  CreateMicrovmAuthTokenCommand,
  CreateMicrovmImageCommand,
  GetMicrovmCommand,
  GetMicrovmImageCommand,
  LambdaMicrovmsClient,
  ResourceNotFoundException,
  ResumeMicrovmCommand,
  RunMicrovmCommand,
  SuspendMicrovmCommand,
  TerminateMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "build", "lifecycle-probe");
const REGION = process.env.AWS_REGION ?? "us-east-1";
const PREFIX = "dex-microvm-e2e";
const connector = (name) =>
  `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:${name}`;
// The suspend and terminate hook timeout. The app answers those hooks after
// 8 seconds. HOOK_TIMEOUT=2 shows what Lambda does when a hook runs past its
// timeout. HOOK_TIMEOUT=unset shows the default timeout.
const HOOK_TIMEOUT = process.env.HOOK_TIMEOUT ?? "30";
const hookTimeouts =
  HOOK_TIMEOUT === "unset"
    ? {}
    : {
        suspendTimeoutInSeconds: Number(HOOK_TIMEOUT),
        terminateTimeoutInSeconds: Number(HOOK_TIMEOUT),
      };
const HOOKS = {
  port: 8080,
  microvmHooks: {
    run: "ENABLED",
    runTimeoutInSeconds: 10,
    resume: "ENABLED",
    resumeTimeoutInSeconds: 10,
    suspend: "ENABLED",
    terminate: "ENABLED",
    ...hookTimeouts,
  },
  microvmImageHooks: { ready: "ENABLED", readyTimeoutInSeconds: 60 },
};

const microvms = new LambdaMicrovmsClient({ region: REGION });
const logsClient = new CloudWatchLogsClient({ region: REGION });
const started = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) =>
  console.log(`[${new Date().toISOString()}] ${message}`);

async function ensureImage(account) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await build({
    entryPoints: [join(HERE, "lifecycle-probe-app.mjs")],
    outfile: join(OUT, "app.mjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: "warning",
  });
  writeFileSync(
    join(OUT, "Dockerfile"),
    readFileSync(join(HERE, "Dockerfile")),
  );
  execFileSync("zip", [
    "-qj",
    join(OUT, "probe.zip"),
    join(OUT, "app.mjs"),
    join(OUT, "Dockerfile"),
  ]);
  const hash = createHash("sha256")
    .update(readFileSync(join(OUT, "app.mjs")))
    .update(JSON.stringify(HOOKS))
    .digest("hex")
    .slice(0, 10);
  const name = `${PREFIX}-lifecycle-${hash}`;
  const arn = `arn:aws:lambda:${REGION}:${account}:microvm-image:${name}`;
  const get = () =>
    microvms
      .send(new GetMicrovmImageCommand({ imageIdentifier: arn }))
      .catch((error) => {
        if (error instanceof ResourceNotFoundException) return undefined;
        throw error;
      });
  if (!(await get())) {
    const bucket = `${PREFIX}-${account}-${REGION}`;
    const key = `lifecycle-probe/${name}.zip`;
    await new S3Client({ region: REGION }).send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: readFileSync(join(OUT, "probe.zip")),
      }),
    );
    log(`creating image ${name}`);
    await microvms.send(
      new CreateMicrovmImageCommand({
        name,
        codeArtifact: { uri: `s3://${bucket}/${key}` },
        baseImageArn: `arn:aws:lambda:${REGION}:aws:microvm-image:al2023-1`,
        buildRoleArn: `arn:aws:iam::${account}:role/${PREFIX}-build`,
        egressNetworkConnectors: [connector("INTERNET_EGRESS")],
        hooks: HOOKS,
      }),
    );
  }
  for (;;) {
    const image = await get();
    if (image?.state === "CREATED" && image.latestActiveImageVersion) {
      log(`image ${name} is ready`);
      return { arn, name };
    }
    if (/FAILED/.test(image?.state ?? "")) {
      throw new Error(`image ${name} is ${image.state}`);
    }
    await sleep(10_000);
  }
}

async function run(image, account, extra = {}) {
  const response = await microvms.send(
    new RunMicrovmCommand({
      imageIdentifier: image.arn,
      executionRoleArn: `arn:aws:iam::${account}:role/${PREFIX}-microvm`,
      ingressNetworkConnectors: [connector("ALL_INGRESS")],
      egressNetworkConnectors: [connector("INTERNET_EGRESS")],
      runHookPayload: JSON.stringify({ version: 1, region: REGION }),
      maximumDurationInSeconds: 900,
      clientToken: randomUUID(),
      ...extra,
    }),
  );
  started.add(response.microvmId);
  return response;
}

const state = async (id) => {
  try {
    const vm = await microvms.send(
      new GetMicrovmCommand({ microvmIdentifier: id }),
    );
    return vm.state;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return "NOT_FOUND";
    throw error;
  }
};

/** Polls the state every second, and records each change. */
async function watch(id, until, maxMs, timeline) {
  const deadline = Date.now() + maxMs;
  let last;
  for (;;) {
    const current = await state(id);
    if (current !== last) {
      timeline.push({ at: new Date().toISOString(), state: current });
      last = current;
    }
    if (until.includes(current) || Date.now() > deadline) return current;
    await sleep(1_000);
  }
}

async function call(timeline, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    timeline.push({
      at: new Date(t0).toISOString(),
      call: name,
      ms: Date.now() - t0,
    });
  } catch (error) {
    timeline.push({
      at: new Date(t0).toISOString(),
      call: name,
      ms: Date.now() - t0,
      error: `${error.name}: ${error.message}`,
    });
  }
}

const terminate = (id) =>
  microvms.send(new TerminateMicrovmCommand({ microvmIdentifier: id }));
const suspend = (id) =>
  microvms.send(new SuspendMicrovmCommand({ microvmIdentifier: id }));
const resume = (id) =>
  microvms.send(new ResumeMicrovmCommand({ microvmIdentifier: id }));

async function postToMicrovm(vm, path) {
  const { authToken } = await microvms.send(
    new CreateMicrovmAuthTokenCommand({
      microvmIdentifier: vm.microvmId,
      expirationInMinutes: 5,
      allowedPorts: [{ port: 8080 }],
    }),
  );
  const base = /^https?:\/\//.test(vm.endpoint)
    ? vm.endpoint
    : `https://${vm.endpoint}`;
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authToken },
    body: "{}",
    signal: AbortSignal.timeout(20_000),
  });
  return response.status;
}

const SCENARIOS = {
  // TerminateMicrovm on a running MicroVM.
  terminate: async (image, account) => {
    const timeline = [];
    const vm = await run(image, account);
    await watch(vm.microvmId, ["RUNNING"], 120_000, timeline);
    await sleep(5_000);
    await call(timeline, "TerminateMicrovm", () => terminate(vm.microvmId));
    await watch(vm.microvmId, ["TERMINATED", "NOT_FOUND"], 90_000, timeline);
    return { microvmId: vm.microvmId, timeline };
  },
  // The end of maximumDurationInSeconds.
  "max-duration": async (image, account) => {
    const timeline = [];
    const vm = await run(image, account, { maximumDurationInSeconds: 45 });
    await watch(vm.microvmId, ["TERMINATED", "NOT_FOUND"], 240_000, timeline);
    return { microvmId: vm.microvmId, timeline };
  },
  // SuspendMicrovm from outside, then ResumeMicrovm, then TerminateMicrovm.
  "suspend-resume": async (image, account) => {
    const timeline = [];
    const vm = await run(image, account);
    await watch(vm.microvmId, ["RUNNING"], 120_000, timeline);
    await sleep(5_000);
    await call(timeline, "SuspendMicrovm", () => suspend(vm.microvmId));
    await watch(vm.microvmId, ["SUSPENDED"], 90_000, timeline);
    await sleep(10_000);
    await call(timeline, "ResumeMicrovm", () => resume(vm.microvmId));
    await watch(vm.microvmId, ["RUNNING"], 90_000, timeline);
    await sleep(5_000);
    await call(timeline, "TerminateMicrovm", () => terminate(vm.microvmId));
    await watch(vm.microvmId, ["TERMINATED", "NOT_FOUND"], 90_000, timeline);
    return { microvmId: vm.microvmId, timeline };
  },
  // SuspendMicrovm from outside, then TerminateMicrovm while suspended.
  "terminate-suspended": async (image, account) => {
    const timeline = [];
    const vm = await run(image, account);
    await watch(vm.microvmId, ["RUNNING"], 120_000, timeline);
    await sleep(5_000);
    await call(timeline, "SuspendMicrovm", () => suspend(vm.microvmId));
    await watch(vm.microvmId, ["SUSPENDED"], 90_000, timeline);
    await sleep(10_000);
    await call(timeline, "TerminateMicrovm", () => terminate(vm.microvmId));
    await watch(vm.microvmId, ["TERMINATED", "NOT_FOUND"], 90_000, timeline);
    return { microvmId: vm.microvmId, timeline };
  },
  // SuspendMicrovm from inside the MicroVM, as the worker calls it.
  "self-suspend": async (image, account) => {
    const timeline = [];
    const vm = await run(image, account);
    await watch(vm.microvmId, ["RUNNING"], 120_000, timeline);
    await sleep(5_000);
    await call(timeline, "POST /self-suspend", async () => {
      timeline.push({ status: await postToMicrovm(vm, "/self-suspend") });
    });
    await watch(vm.microvmId, ["SUSPENDED"], 90_000, timeline);
    await sleep(5_000);
    await call(timeline, "TerminateMicrovm", () => terminate(vm.microvmId));
    await watch(vm.microvmId, ["TERMINATED", "NOT_FOUND"], 90_000, timeline);
    return { microvmId: vm.microvmId, timeline };
  },
  // The idle policy suspends the MicroVM, then terminates it after the
  // suspended duration.
  "idle-policy": async (image, account) => {
    const timeline = [];
    const vm = await run(image, account, {
      idlePolicy: {
        maxIdleDurationSeconds: 60,
        suspendedDurationSeconds: 60,
        autoResumeEnabled: false,
      },
    });
    await watch(vm.microvmId, ["SUSPENDED"], 240_000, timeline);
    await watch(vm.microvmId, ["TERMINATED", "NOT_FOUND"], 240_000, timeline);
    return { microvmId: vm.microvmId, timeline };
  },
  // A forwarded request to the terminate hook path, for comparison with
  // Lambda's own call.
  "forwarded-terminate": async (image, account) => {
    const timeline = [];
    const vm = await run(image, account);
    await watch(vm.microvmId, ["RUNNING"], 120_000, timeline);
    await sleep(5_000);
    await call(timeline, "POST terminate hook path", async () => {
      timeline.push({
        status: await postToMicrovm(
          vm,
          "/aws/lambda-microvms/runtime/v1/terminate",
        ),
      });
    });
    await call(timeline, "TerminateMicrovm", () => terminate(vm.microvmId));
    await watch(vm.microvmId, ["TERMINATED", "NOT_FOUND"], 90_000, timeline);
    return { microvmId: vm.microvmId, timeline };
  },
};

/** Reads the probe app's lines from the MicroVM's log stream. */
async function probeLines(image, microvmId) {
  const group = `/aws/lambda-microvms/${image.name}`;
  for (let i = 0; i < 12; i++) {
    const streams = await logsClient.send(
      new DescribeLogStreamsCommand({
        logGroupName: group,
        orderBy: "LastEventTime",
        descending: true,
        limit: 50,
      }),
    );
    const stream = streams.logStreams?.find((s) =>
      s.logStreamName?.endsWith(microvmId),
    );
    if (stream) {
      const lines = [];
      let token;
      for (;;) {
        const page = await logsClient.send(
          new GetLogEventsCommand({
            logGroupName: group,
            logStreamName: stream.logStreamName,
            startFromHead: true,
            nextToken: token,
          }),
        );
        for (const event of page.events ?? []) {
          try {
            const line = JSON.parse(event.message);
            if (line.probe) lines.push(line);
          } catch {
            // Not a probe line.
          }
        }
        if (!page.nextForwardToken || page.nextForwardToken === token) break;
        token = page.nextForwardToken;
      }
      return lines;
    }
    await sleep(10_000);
  }
  return [];
}

/** Keeps the interesting lines, and the first and last tick around them. */
function summarize(lines) {
  const out = [];
  let lastTick;
  for (const line of lines) {
    if (line.probe === "tick") {
      lastTick = line;
      continue;
    }
    if (lastTick) {
      out.push({
        probe: "last tick before",
        at: lastTick.at,
        tick: lastTick.tick,
      });
      lastTick = undefined;
    }
    const { probe, at, uptimeMs, ...rest } = line;
    delete rest.microvmId;
    out.push({ probe, at, ...rest });
  }
  if (lastTick)
    out.push({ probe: "last tick", at: lastTick.at, tick: lastTick.tick });
  return out;
}

async function main() {
  const account = execFileSync(
    "aws",
    ["sts", "get-caller-identity", "--query", "Account", "--output", "text"],
    { encoding: "utf8" },
  ).trim();
  const image = await ensureImage(account);
  const names = (
    process.env.PROBE_SCENARIOS ?? Object.keys(SCENARIOS).join(",")
  )
    .split(",")
    .filter(Boolean);
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        return { name, ...(await SCENARIOS[name](image, account)) };
      } catch (error) {
        return { name, error: `${error.name}: ${error.message}` };
      }
    }),
  );
  for (const result of results) {
    if (result.microvmId) {
      result.app = summarize(await probeLines(image, result.microvmId));
    }
  }
  const path = join(OUT, `results-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(results, null, 2));
  log(`results written to ${path}`);
}

try {
  await main();
} finally {
  for (const id of started) {
    await terminate(id).catch(() => undefined);
  }
}
