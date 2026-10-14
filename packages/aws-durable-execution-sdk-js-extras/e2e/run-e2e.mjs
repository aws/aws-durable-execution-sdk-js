#!/usr/bin/env node
// End-to-end test for the microvm operation and the MicroVM worker, against a
// real AWS account. It creates (or reuses) every resource it needs, all named
// with the "dex-microvm-e2e" prefix, runs its scenarios, and verifies the
// durable execution outcome, the operation history, and that every MicroVM
// was terminated.
//
// Prerequisites: AWS CLI v2 credentials for the target account, and a built
// workspace (npm run build in the SDK, extras, and microvm-worker packages).
//
// Usage: node e2e/run-e2e.mjs            (from the extras package)
//        AWS_REGION=us-east-1 node e2e/run-e2e.mjs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "build");
const REGION = process.env.AWS_REGION ?? "us-east-1";
const PREFIX = "dex-microvm-e2e";
const BASE_IMAGE_ARN = `arn:aws:lambda:${REGION}:aws:microvm-image:al2023-1`;
const INTERNET_EGRESS = `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:INTERNET_EGRESS`;

const log = (message) =>
  console.log(`[${new Date().toISOString()}] ${message}`);

function aws(args, { json = true, allowFailure = false } = {}) {
  try {
    const out = execFileSync(
      "aws",
      [...args, "--region", REGION, ...(json ? ["--output", "json"] : [])],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return json && out.trim() ? JSON.parse(out) : out;
  } catch (error) {
    if (allowFailure) {
      return undefined;
    }
    throw new Error(
      `aws ${args.slice(0, 2).join(" ")} failed: ${error.stderr ?? error.message}`,
    );
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- bundles

async function bundle() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "function"), { recursive: true });
  mkdirSync(join(OUT, "microvm"), { recursive: true });

  // The function bundle includes the durable SDK and the MicroVMs client. The
  // Lambda runtime's bundled AWS SDK may predate the MicroVMs client.
  await build({
    entryPoints: [join(HERE, "function.ts")],
    outfile: join(OUT, "function", "index.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    logLevel: "warning",
  });
  // The app uses top-level await, so it is an ES module. The banner gives
  // bundled CommonJS dependencies a working require().
  await build({
    entryPoints: [join(HERE, "microvm-app.ts")],
    outfile: join(OUT, "microvm", "app.mjs"),
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
    join(OUT, "microvm", "Dockerfile"),
    readFileSync(join(HERE, "Dockerfile")),
  );

  execFileSync("zip", [
    "-qj",
    join(OUT, "function.zip"),
    join(OUT, "function", "index.js"),
  ]);
  execFileSync("zip", [
    "-qj",
    join(OUT, "microvm.zip"),
    join(OUT, "microvm", "app.mjs"),
    join(OUT, "microvm", "Dockerfile"),
  ]);

  const hash = createHash("sha256")
    .update(readFileSync(join(OUT, "microvm", "app.mjs")))
    .update(readFileSync(join(OUT, "microvm", "Dockerfile")))
    .update(JSON.stringify(IMAGE_HOOKS))
    .digest("hex")
    .slice(0, 10);
  return { imageHash: hash };
}

// ---------------------------------------------------------------- IAM + S3

const LAMBDA_TRUST = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: ["sts:AssumeRole", "sts:TagSession"],
    },
  ],
});

function ensureRole(name, policy, managedPolicies = []) {
  let created = false;
  let role = aws(["iam", "get-role", "--role-name", name], {
    allowFailure: true,
  });
  if (!role) {
    log(`creating role ${name}`);
    role = aws([
      "iam",
      "create-role",
      "--role-name",
      name,
      "--assume-role-policy-document",
      LAMBDA_TRUST,
    ]);
    created = true;
  }
  aws(
    [
      "iam",
      "put-role-policy",
      "--role-name",
      name,
      "--policy-name",
      "e2e",
      "--policy-document",
      JSON.stringify({ Version: "2012-10-17", Statement: policy }),
    ],
    { json: false },
  );
  for (const arn of managedPolicies) {
    aws(
      ["iam", "attach-role-policy", "--role-name", name, "--policy-arn", arn],
      {
        json: false,
      },
    );
  }
  return { arn: role.Role.Arn, created };
}

function ensureInfrastructure(account) {
  const bucket = `${PREFIX}-${account}-${REGION}`;
  if (
    !aws(["s3api", "head-bucket", "--bucket", bucket], {
      allowFailure: true,
      json: false,
    })
  ) {
    log(`creating bucket ${bucket}`);
    aws(
      REGION === "us-east-1"
        ? ["s3api", "create-bucket", "--bucket", bucket]
        : [
            "s3api",
            "create-bucket",
            "--bucket",
            bucket,
            "--create-bucket-configuration",
            `LocationConstraint=${REGION}`,
          ],
    );
  }

  const functionArnPattern = `arn:aws:lambda:${REGION}:${account}:function:${PREFIX}-fn:*`;
  const logs = {
    Effect: "Allow",
    Action: [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ],
    Resource: "*",
  };

  const buildRole = ensureRole(`${PREFIX}-build`, [
    {
      Effect: "Allow",
      Action: ["s3:GetObject"],
      Resource: `arn:aws:s3:::${bucket}/*`,
    },
    logs,
  ]);
  // The role the MicroVM assumes: it completes the durable callback, and the
  // worker suspends its own idle session MicroVM. SuspendMicrovm authorizes
  // on the MicroVM image, so the statement names the test's images.
  const microvmRole = ensureRole(`${PREFIX}-microvm`, [
    {
      Effect: "Allow",
      Action: [
        "lambda:SendDurableExecutionCallbackSuccess",
        "lambda:SendDurableExecutionCallbackFailure",
        "lambda:SendDurableExecutionCallbackHeartbeat",
      ],
      Resource: functionArnPattern,
    },
    {
      Effect: "Allow",
      Action: ["lambda:SuspendMicrovm"],
      Resource: `arn:aws:lambda:${REGION}:${account}:microvm-image:${PREFIX}-*`,
    },
    logs,
  ]);
  const microvmRoleName = `${PREFIX}-microvm`;
  const functionRole = ensureRole(
    `${PREFIX}-function`,
    [
      {
        Effect: "Allow",
        Action: [
          "lambda:RunMicrovm",
          "lambda:TerminateMicrovm",
          "lambda:GetMicrovm",
          "lambda:CreateMicrovmAuthToken",
          // A session resumes a MicroVM that suspended itself between jobs.
          "lambda:ResumeMicrovm",
        ],
        Resource: "*",
      },
      // RunMicrovm also authorizes each network connector it attaches.
      {
        Effect: "Allow",
        Action: ["lambda:PassNetworkConnector"],
        Resource: `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:*`,
      },
      {
        Effect: "Allow",
        Action: ["iam:PassRole"],
        Resource: `arn:aws:iam::${account}:role/${microvmRoleName}`,
      },
    ],
    [
      "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy",
    ],
  );
  return {
    bucket,
    buildRoleArn: buildRole.arn,
    microvmRoleArn: microvmRole.arn,
    functionRoleArn: functionRole.arn,
    rolesCreated:
      buildRole.created || microvmRole.created || functionRole.created,
  };
}

// ---------------------------------------------------------------- MicroVM image

const IMAGE_HOOKS = {
  port: 8080,
  microvmHooks: {
    run: "ENABLED",
    runTimeoutInSeconds: 10,
    // The worker stops refusing jobs as soon as this hook arrives after its
    // own suspend.
    resume: "ENABLED",
    resumeTimeoutInSeconds: 10,
    // The worker refuses jobs from this hook until the resume hook.
    suspend: "ENABLED",
    suspendTimeoutInSeconds: 10,
    // The worker fails the callbacks of running jobs before it answers.
    terminate: "ENABLED",
    terminateTimeoutInSeconds: 10,
  },
  // The service requires the ready hook whenever a lifecycle hook is
  // enabled. The worker answers it with 200 once it is listening.
  microvmImageHooks: { ready: "ENABLED", readyTimeoutInSeconds: 60 },
};

async function ensureImage(infra, account, imageHash) {
  const name = `${PREFIX}-${imageHash}`;
  // GetMicrovmImage accepts only the ARN, not the name.
  const arn = `arn:aws:lambda:${REGION}:${account}:microvm-image:${name}`;
  let image = aws(
    ["lambda-microvms", "get-microvm-image", "--image-identifier", arn],
    { allowFailure: true },
  );
  if (!image) {
    const key = `microvm/${imageHash}.zip`;
    aws(["s3", "cp", join(OUT, "microvm.zip"), `s3://${infra.bucket}/${key}`], {
      json: false,
    });
    log(`creating MicroVM image ${name}`);
    aws([
      "lambda-microvms",
      "create-microvm-image",
      "--cli-input-json",
      JSON.stringify({
        name,
        codeArtifact: { uri: `s3://${infra.bucket}/${key}` },
        baseImageArn: BASE_IMAGE_ARN,
        buildRoleArn: infra.buildRoleArn,
        egressNetworkConnectors: [INTERNET_EGRESS],
        hooks: IMAGE_HOOKS,
      }),
    ]);
  }
  for (let i = 0; ; i++) {
    image = aws([
      "lambda-microvms",
      "get-microvm-image",
      "--image-identifier",
      arn,
    ]);
    if (
      ["CREATED", "UPDATED"].includes(image.state) &&
      image.latestActiveImageVersion
    ) {
      log(
        `image ${name} is ${image.state}, version ${image.latestActiveImageVersion}`,
      );
      return image.imageArn;
    }
    if (/FAILED/.test(image.state ?? "")) {
      throw new Error(
        `image ${name} is ${image.state}: ${image.stateReason ?? ""}. Build logs: /aws/lambda-microvms/${name}`,
      );
    }
    if (i % 6 === 0) {
      log(`waiting for image ${name}: ${image.state}`);
    }
    await sleep(10_000);
  }
}

// ---------------------------------------------------------------- function

function ensureFunction(infra, imageArn) {
  const name = `${PREFIX}-fn`;
  const environment = JSON.stringify({
    Variables: {
      MICROVM_IMAGE_ARN: imageArn,
      MICROVM_ROLE_ARN: infra.microvmRoleArn,
    },
  });
  const exists = aws(["lambda", "get-function", "--function-name", name], {
    allowFailure: true,
  });
  if (!exists) {
    log(`creating function ${name}`);
    aws([
      "lambda",
      "create-function",
      "--function-name",
      name,
      "--runtime",
      "nodejs22.x",
      "--handler",
      "index.handler",
      "--role",
      infra.functionRoleArn,
      "--timeout",
      "120",
      "--memory-size",
      "512",
      "--environment",
      environment,
      "--durable-config",
      JSON.stringify({ ExecutionTimeout: 3600, RetentionPeriodInDays: 1 }),
      "--zip-file",
      `fileb://${join(OUT, "function.zip")}`,
    ]);
    aws(["lambda", "wait", "function-active-v2", "--function-name", name], {
      json: false,
    });
  } else {
    log(`updating function ${name}`);
    aws([
      "lambda",
      "update-function-code",
      "--function-name",
      name,
      "--zip-file",
      `fileb://${join(OUT, "function.zip")}`,
    ]);
    aws(["lambda", "wait", "function-updated-v2", "--function-name", name], {
      json: false,
    });
    aws([
      "lambda",
      "update-function-configuration",
      "--function-name",
      name,
      "--environment",
      environment,
    ]);
    aws(["lambda", "wait", "function-updated-v2", "--function-name", name], {
      json: false,
    });
  }
  const version = aws(["lambda", "publish-version", "--function-name", name]);
  log(`published ${name}:${version.Version}`);
  return version.FunctionArn;
}

// ---------------------------------------------------------------- scenarios

const SCENARIOS = [
  {
    id: "succeed",
    event: {
      scenario: "single",
      job: { mode: "succeed", sleepSeconds: 20, label: "single" },
      timeoutSeconds: 600,
      heartbeatTimeoutSeconds: 15,
    },
    expect: ({ execution, result, operationNames }) => {
      assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);
      assert(result?.label === "single", `result ${JSON.stringify(result)}`);
      // A small input goes in the run hook. So no request step runs.
      assert(
        !operationNames.includes("job.request"),
        "a small job was delivered over HTTP",
      );
    },
  },
  {
    id: "fail",
    event: {
      scenario: "single",
      job: { mode: "fail", sleepSeconds: 2, label: "failing" },
      timeoutSeconds: 300,
    },
    expect: ({ execution }) => {
      assert(execution.Status === "FAILED", `status ${execution.Status}`);
      assert(
        JSON.stringify(execution.Error ?? {}).includes("failed on purpose"),
        `error ${JSON.stringify(execution.Error)}`,
      );
      assert(
        execution.Error?.ErrorType === "MicrovmJobFailedError",
        `error type ${execution.Error?.ErrorType}`,
      );
    },
  },
  {
    id: "crash",
    event: {
      scenario: "single",
      job: { mode: "crash", sleepSeconds: 0, label: "crashing" },
      timeoutSeconds: 900,
      heartbeatTimeoutSeconds: 15,
    },
    expect: ({ execution, elapsedSeconds }) => {
      assert(execution.Status === "FAILED", `status ${execution.Status}`);
      assert(
        execution.Error?.ErrorType === "MicrovmTimeoutError",
        `error type ${execution.Error?.ErrorType}`,
      );
      // The heartbeat timeout (15 s) must end the wait, not the 900 s callback timeout.
      assert(elapsedSeconds < 300, `took ${elapsedSeconds}s`);
    },
  },
  {
    // The runner terminates the MicroVM while the job runs. The worker's
    // terminate hook then fails the job's callback. So the execution fails
    // at once, long before the 5-minute heartbeat timeout. The runner waits
    // until the MicroVM has been RUNNING for 5 seconds, so that the worker
    // has received the job before the terminate.
    id: "terminated",
    event: {
      scenario: "single",
      job: { mode: "succeed", sleepSeconds: 600, label: "terminated" },
      timeoutSeconds: 900,
      heartbeatTimeoutSeconds: 300,
    },
    terminateAfterRunningSeconds: 5,
    expect: ({ execution, terminatedAfterSeconds, elapsedSeconds }) => {
      assert(execution.Status === "FAILED", `status ${execution.Status}`);
      assert(
        execution.Error?.ErrorType === "MicrovmJobFailedError",
        `error type ${execution.Error?.ErrorType}`,
      );
      assert(
        JSON.stringify(execution.Error ?? {}).includes(
          "MicrovmTerminatedError",
        ),
        `error ${JSON.stringify(execution.Error)}`,
      );
      assert(
        terminatedAfterSeconds !== undefined,
        "the runner did not terminate the MicroVM",
      );
      // The poll interval is 5 seconds, and the durable function needs an
      // invocation to record the failure.
      assert(
        elapsedSeconds - terminatedAfterSeconds < 60,
        `failed ${elapsedSeconds - terminatedAfterSeconds} s after the terminate`,
      );
    },
  },
  {
    id: "request-succeed",
    event: {
      scenario: "single",
      job: { mode: "succeed", sleepSeconds: 20, label: "over-http" },
      timeoutSeconds: 600,
      heartbeatTimeoutSeconds: 15,
      requestPath: "/job",
      // Larger than the 4096-character run hook limit.
      paddingLength: 10_000,
    },
    expect: ({ execution, result, operationNames }) => {
      assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);
      assert(result?.label === "over-http", `result ${JSON.stringify(result)}`);
      assert(
        result?.inputLength > 10_000,
        `inputLength ${result?.inputLength}`,
      );
      assert(
        operationNames.some((n) => n.endsWith(".request")),
        "history has no *.request operation",
      );
    },
  },
  {
    id: "auto-http",
    event: {
      scenario: "single",
      job: { mode: "succeed", sleepSeconds: 5, label: "auto-http" },
      timeoutSeconds: 600,
      heartbeatTimeoutSeconds: 15,
      // Larger than the 4096-character run hook limit, and no requestPath.
      // So microvm must deliver the job over HTTP to the worker's handler.
      paddingLength: 10_000,
    },
    expect: ({ execution, result, operationNames }) => {
      assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);
      assert(result?.label === "auto-http", `result ${JSON.stringify(result)}`);
      assert(
        result?.inputLength > 10_000,
        `inputLength ${result?.inputLength}`,
      );
      assert(
        operationNames.includes("job.request"),
        "history has no job.request operation",
      );
    },
  },
  {
    id: "run-hook-cjk",
    event: {
      scenario: "single",
      job: { mode: "succeed", sleepSeconds: 2, label: "run-hook-cjk" },
      timeoutSeconds: 600,
      heartbeatTimeoutSeconds: 15,
      // 3,400 code points and about 10,600 UTF-8 bytes. It fits the run hook
      // only because the service counts code points.
      paddingLength: 3_400,
      paddingChar: "日",
    },
    expect: ({ execution, result, operationNames }) => {
      assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);
      assert(
        result?.padding === "日".repeat(3_400),
        "the MicroVM did not receive the padding unchanged",
      );
      assert(
        !operationNames.includes("job.request"),
        "the job went over HTTP, not in the run hook",
      );
    },
  },
  {
    id: "run-hook-emoji",
    event: {
      scenario: "single",
      job: { mode: "succeed", sleepSeconds: 2, label: "run-hook-emoji" },
      timeoutSeconds: 600,
      heartbeatTimeoutSeconds: 15,
      // 3,400 code points, 6,800 UTF-16 code units, and about 13,900 bytes.
      paddingLength: 3_400,
      paddingChar: "😀",
    },
    expect: ({ execution, result, operationNames }) => {
      assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);
      assert(
        result?.padding === "😀".repeat(3_400),
        "the MicroVM did not receive the padding unchanged",
      );
      assert(
        !operationNames.includes("job.request"),
        "the job went over HTTP, not in the run hook",
      );
    },
  },
  {
    id: "auto-http-cjk",
    event: {
      scenario: "single",
      job: { mode: "succeed", sleepSeconds: 2, label: "auto-http-cjk" },
      timeoutSeconds: 600,
      heartbeatTimeoutSeconds: 15,
      // 4,200 code points: past the run hook limit.
      paddingLength: 4_200,
      paddingChar: "日",
    },
    expect: ({ execution, result, operationNames }) => {
      assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);
      assert(
        result?.padding === "日".repeat(4_200),
        "the MicroVM did not receive the padding unchanged",
      );
      assert(
        operationNames.includes("job.request"),
        "history has no job.request operation",
      );
    },
  },
  {
    id: "request-fail",
    event: {
      scenario: "single",
      job: { mode: "fail", sleepSeconds: 2, label: "failing-http" },
      timeoutSeconds: 300,
      requestPath: "/job",
    },
    expect: ({ execution }) => {
      assert(execution.Status === "FAILED", `status ${execution.Status}`);
      assert(
        JSON.stringify(execution.Error ?? {}).includes("failed on purpose"),
        `error ${JSON.stringify(execution.Error)}`,
      );
      assert(
        execution.Error?.ErrorType === "MicrovmJobFailedError",
        `error type ${execution.Error?.ErrorType}`,
      );
    },
  },
  {
    id: "session",
    event: {
      scenario: "session",
      job: { mode: "succeed", sleepSeconds: 0, label: "session-key" },
      timeoutSeconds: 900,
    },
    expect: ({ execution, result, microvmIds, operationNames, subTypes }) => {
      assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);
      assert(
        result?.read?.value === "written-by-session-key",
        `result ${JSON.stringify(result)}`,
      );
      assert(
        subTypes.pipeline === "MicrovmSession" &&
          subTypes.write === "MicrovmSessionJob" &&
          subTypes.read === "MicrovmSessionJob",
        `session subtypes ${JSON.stringify(subTypes)}`,
      );
      assert(microvmIds.length === 1, `launches ${microvmIds}`);
      assert(
        result.written.microvmId === microvmIds[0] &&
          result.read.microvmId === microvmIds[0] &&
          result.sessionMicrovmId === microvmIds[0],
        "the two jobs did not run in the session's MicroVM",
      );
      for (const op of [
        "pipeline.session",
        "write.request",
        "read.request",
        "pause",
      ]) {
        assert(operationNames.includes(op), `history has no ${op}`);
      }
    },
  },
  {
    id: "suspend-session",
    // The runner polls the MicroVM state while the execution runs.
    observeMicrovm: true,
    event: {
      scenario: "suspend-session",
      job: { mode: "succeed", sleepSeconds: 0, label: "suspend-key" },
      timeoutSeconds: 900,
      pauseSeconds: 60,
      // The worker suspends the MicroVM 10 seconds after the first job ends,
      // during the 60-second wait.
      autoSuspendIdleSeconds: 10,
    },
    expect: ({ execution, result, observedStates, operationNames }) => {
      assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);
      // The value lives only in the worker's memory. The same value and
      // process ID after the waits show that the resume restored the memory.
      assert(
        result?.recalled?.value === "suspend-key" &&
          result.recalled.pid === result.remembered.pid,
        `result ${JSON.stringify(result)}`,
      );
      assert(
        observedStates.includes("SUSPENDED"),
        `observed states ${observedStates}`,
      );
      // The service called the resume hook after the self-suspend. So the
      // worker stopped refusing jobs without its 30-second fallback.
      assert(
        result.recalled.resumeHooks >= 1,
        `resume hooks ${result.recalled.resumeHooks}`,
      );
      for (const op of ["long-pause", "second-pause", "recall.request"]) {
        assert(operationNames.includes(op), `history has no ${op}`);
      }
    },
  },
  // Opt-in probes. They take minutes and answer design questions, so the
  // default run skips them. Select them with E2E_SCENARIOS.
  {
    id: "long-job",
    optional: true,
    event: {
      scenario: "single",
      job: { mode: "succeed", sleepSeconds: 600, label: "long" },
      timeoutSeconds: 1_200,
      heartbeatTimeoutSeconds: 60,
    },
    // No idle policy is set. A heartbeat timeout would show that the MicroVM
    // was suspended during the job.
    expect: ({ execution, elapsedSeconds }) => {
      assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);
      assert(elapsedSeconds >= 600, `took ${elapsedSeconds}s`);
    },
  },
  {
    id: "idle-probe",
    optional: true,
    event: {
      scenario: "idle-session",
      job: { mode: "succeed", sleepSeconds: 240, label: "idle" },
      timeoutSeconds: 900,
      heartbeatTimeoutSeconds: 30,
      idlePolicy: {
        autoResumeEnabled: true,
        maxIdleDurationSeconds: 60,
        suspendedDurationSeconds: 600,
      },
    },
    // Both outcomes answer the question, so this probe only reports.
    // SUCCEEDED: outbound heartbeats kept the MicroVM running.
    // FAILED with CallbackTimeoutError: the MicroVM was suspended mid-job.
    expect: () => {},
  },
  {
    id: "parallel",
    event: {
      scenario: "parallel",
      job: { mode: "succeed", sleepSeconds: 5, label: "" },
      timeoutSeconds: 600,
    },
    expect: ({ execution, result, microvmIds }) => {
      assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);
      assert(
        Array.isArray(result) && result.length === 2,
        `result ${JSON.stringify(result)}`,
      );
      assert(new Set(microvmIds).size === 2, `microvmIds ${microvmIds}`);
      assert(
        result.every((r) => microvmIds.includes(r.microvmId)),
        "result microvmIds do not match the launch steps",
      );
    },
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runScenario(functionArn, scenario, runId) {
  const name = `${scenario.id}-${runId}`;
  const started = Date.now();
  const payloadFile = join(OUT, `${name}.json`);
  writeFileSync(payloadFile, JSON.stringify(scenario.event));
  const invoked = aws([
    "lambda",
    "invoke",
    "--function-name",
    functionArn,
    "--invocation-type",
    "Event",
    "--durable-execution-name",
    name,
    "--cli-binary-format",
    "raw-in-base64-out",
    "--payload",
    `fileb://${payloadFile}`,
    join(OUT, `${name}.out`),
  ]);
  const executionArn =
    invoked.DurableExecutionArn ?? findExecutionArn(functionArn, name);
  log(`${scenario.id}: started ${executionArn}`);

  let execution;
  // The distinct MicroVM states seen while the execution runs, in order.
  const observedStates = [];
  // Seconds after the start at which the runner terminated the MicroVM.
  let terminatedAfterSeconds;
  // When the runner first saw the MicroVM RUNNING.
  let runningSince;
  for (;;) {
    execution = aws([
      "lambda",
      "get-durable-execution",
      "--durable-execution-arn",
      executionArn,
    ]);
    if (execution.Status !== "RUNNING") {
      break;
    }
    if (
      scenario.terminateAfterRunningSeconds !== undefined &&
      terminatedAfterSeconds === undefined
    ) {
      // The launch step records only that RunMicrovm returned. The MicroVM
      // can still be booting then, and a terminate before the worker has the
      // job would end in the heartbeat timeout instead.
      const microvmId = launchedMicrovmId(executionArn);
      const state = microvmId ? microvmState(microvmId) : undefined;
      if (state === "RUNNING") {
        runningSince ??= Date.now();
      }
      if (
        microvmId &&
        runningSince !== undefined &&
        (Date.now() - runningSince) / 1000 >=
          scenario.terminateAfterRunningSeconds
      ) {
        aws([
          "lambda-microvms",
          "terminate-microvm",
          "--microvm-identifier",
          microvmId,
        ]);
        terminatedAfterSeconds = Math.round((Date.now() - started) / 1000);
        log(`${scenario.id}: terminated ${microvmId}`);
      }
    }
    if (scenario.observeMicrovm) {
      const state = observeMicrovmState(executionArn);
      if (state && observedStates.at(-1) !== state) {
        observedStates.push(state);
        log(`${scenario.id}: MicroVM is ${state}`);
      }
    }
    if ((Date.now() - started) / 1000 > 1200) {
      throw new Error(`${scenario.id}: still RUNNING after 20 minutes`);
    }
    await sleep(5_000);
  }
  const elapsedSeconds = Math.round((Date.now() - started) / 1000);
  const history = aws([
    "lambda",
    "get-durable-execution-history",
    "--durable-execution-arn",
    executionArn,
    "--include-execution-data",
  ]);
  const events = history.Events ?? [];
  const microvmIds = events
    .filter(
      (e) => e.EventType === "StepSucceeded" && /\.launch$/.test(e.Name ?? ""),
    )
    .map(
      (e) =>
        JSON.parse(e.StepSucceededDetails?.Result?.Payload ?? "{}").microvmId,
    );
  const result =
    execution.Result === undefined ? undefined : JSON.parse(execution.Result);

  const microvmStates = microvmIds.map((id) => {
    const vm = aws(
      ["lambda-microvms", "get-microvm", "--microvm-identifier", id],
      {
        allowFailure: true,
      },
    );
    return { id, state: vm?.state ?? "NOT_FOUND", reason: vm?.stateReason };
  });
  const operationNames = [
    ...new Set(events.map((e) => e.Name).filter(Boolean)),
  ];
  // Every event of one operation carries the same subtype.
  const subTypes = Object.fromEntries(
    events.filter((e) => e.Name).map((e) => [e.Name, e.SubType]),
  );
  return {
    scenario,
    executionArn,
    execution,
    result,
    elapsedSeconds,
    microvmIds,
    microvmStates,
    observedStates,
    terminatedAfterSeconds,
    operationNames,
    subTypes,
  };
}

/** Returns the ID of the execution's launched MicroVM, once it has one. */
function launchedMicrovmId(executionArn) {
  const history = aws(
    [
      "lambda",
      "get-durable-execution-history",
      "--durable-execution-arn",
      executionArn,
      "--include-execution-data",
    ],
    { allowFailure: true },
  );
  const launch = (history?.Events ?? []).find(
    (e) => e.EventType === "StepSucceeded" && /\.launch$/.test(e.Name ?? ""),
  );
  return launch
    ? JSON.parse(launch.StepSucceededDetails?.Result?.Payload ?? "{}").microvmId
    : undefined;
}

/** Returns the MicroVM's state, or NOT_FOUND. */
function microvmState(microvmId) {
  const vm = aws(
    ["lambda-microvms", "get-microvm", "--microvm-identifier", microvmId],
    { allowFailure: true },
  );
  return vm?.state ?? "NOT_FOUND";
}

/** Returns the state of the execution's launched MicroVM, once it has one. */
function observeMicrovmState(executionArn) {
  const microvmId = launchedMicrovmId(executionArn);
  return microvmId ? microvmState(microvmId) : undefined;
}

function findExecutionArn(functionArn, name) {
  for (let i = 0; i < 30; i++) {
    const list = aws([
      "lambda",
      "list-durable-executions-by-function",
      "--function-name",
      functionArn,
    ]);
    const match = (list.DurableExecutions ?? []).find(
      (e) => e.DurableExecutionName === name,
    );
    if (match) {
      return match.DurableExecutionArn;
    }
    execFileSync("sleep", ["2"]);
  }
  throw new Error(`no durable execution named ${name}`);
}

// ---------------------------------------------------------------- main

const account = aws(["sts", "get-caller-identity"]).Account;
log(`account ${account}, region ${REGION}`);
const { imageHash } = await bundle();
const infra = ensureInfrastructure(account);
if (infra.rolesCreated) {
  log("waiting 15 s for new IAM roles to propagate");
  await sleep(15_000);
}
const imageArn = await ensureImage(infra, account, imageHash);
const functionArn = ensureFunction(infra, imageArn);

const runId = Date.now().toString(36);
const only = process.env.E2E_SCENARIOS?.split(",");
const selected = SCENARIOS.filter((s) =>
  only ? only.includes(s.id) : !s.optional,
);
const outcomes = await Promise.all(
  selected.map((s) =>
    runScenario(functionArn, s, runId).catch((error) => ({
      scenario: s,
      error,
    })),
  ),
);

let failures = 0;
for (const outcome of outcomes) {
  const { scenario } = outcome;
  const problems = [];
  if (outcome.error) {
    problems.push(outcome.error.message);
  } else {
    try {
      scenario.expect(outcome);
    } catch (error) {
      problems.push(error.message);
    }
    for (const suffix of [".callback", ".launch", ".terminate"]) {
      if (!outcome.operationNames.some((n) => n.endsWith(suffix))) {
        problems.push(`history has no *${suffix} operation`);
      }
    }
    if (outcome.microvmIds.length === 0) {
      problems.push("no launch step result");
    }
    // The operations label their parts. The names come from the scenario,
    // so match the generated ones by suffix.
    const bySuffix = {
      ".callback": "MicrovmCallback",
      ".launch": "MicrovmLaunch",
      ".request": "MicrovmRequest",
      ".session": "MicrovmSessionId",
      ".terminate": "MicrovmTerminate",
    };
    for (const [name, subType] of Object.entries(outcome.subTypes)) {
      const suffix = Object.keys(bySuffix).find((s) => name.endsWith(s));
      if (suffix && subType !== bySuffix[suffix]) {
        problems.push(`${name} has subtype ${subType}`);
      }
    }
    const roots = Object.values(outcome.subTypes).filter(
      (s) => s === "Microvm" || s === "MicrovmSession",
    );
    if (roots.length === 0) {
      problems.push("history has no Microvm or MicrovmSession context");
    }
    for (const vm of outcome.microvmStates) {
      if (!["TERMINATING", "TERMINATED", "NOT_FOUND"].includes(vm.state)) {
        problems.push(`MicroVM ${vm.id} is ${vm.state}`);
      }
    }
  }
  failures += problems.length > 0 ? 1 : 0;
  console.log(
    JSON.stringify(
      {
        scenario: scenario.id,
        ok: problems.length === 0,
        problems,
        status: outcome.execution?.Status,
        elapsedSeconds: outcome.elapsedSeconds,
        result: outcome.result,
        error: outcome.execution?.Error,
        operations: outcome.operationNames,
        subTypes: outcome.subTypes,
        observedStates: outcome.observedStates,
        microvms: outcome.microvmStates,
        executionArn: outcome.executionArn,
      },
      null,
      2,
    ),
  );
}
log(`${selected.length - failures}/${selected.length} scenarios passed`);
process.exit(failures === 0 ? 0 : 1);
