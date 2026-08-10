// @ts-check

/**
 * Cloud test for a durable function running on LLRT, deployed as a container image.
 *
 * The managed-runtime integration tests cover nodejs22.x and nodejs24.x. This covers the other
 * supported packaging: an OCI image, which is what makes it possible to bring a runtime that
 * Lambda does not manage. The handler is bundled for LLRT, baked into an image alongside the
 * LLRT binary, deployed with durable execution enabled, and then driven with
 * `CloudDurableTestRunner` — the same assertion machinery the managed-runtime tests use. The
 * runner itself runs here on Node, so nothing about the assertions depends on LLRT.
 *
 * Deliberately not wired into the default PR build: it needs an ECR repository and pushes a
 * container image, and its cost and blast radius are unlike the other integration jobs. The
 * in-repo counterpart is `constrained-runtime.composed.test.ts`, which covers the SDK's
 * behaviour on such a runtime without leaving the Jest process; this covers the deployment
 * shape, which cannot be simulated.
 *
 * Requires: AWS credentials, TEST_LAMBDA_EXECUTION_ROLE_ARN (with
 * lambda:CheckpointDurableExecution and lambda:GetDurableExecutionState), AWS_REGION, and a
 * container CLI. The image and function architecture follow the host, so nothing is emulated:
 * x86_64 on the hosted runners, arm64 on an Apple Silicon laptop. Set CONTAINER_CLI=finch to
 * build without a Docker daemon.
 */

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { build } from "esbuild";
import {
  LambdaClient,
  CreateFunctionCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  ListFunctionsCommand,
  PublishVersionCommand,
  ResourceNotFoundException,
  UpdateFunctionCodeCommand,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { CloudDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../..");
const WORK_DIR = join(__dirname, ".cloud-work");

const LLRT_VERSION = "v0.8.1-beta";
const REGION = process.env.AWS_REGION || "us-east-1";
const ROLE_ARN = process.env.TEST_LAMBDA_EXECUTION_ROLE_ARN;
const ECR_REPO = process.env.LLRT_ECR_REPOSITORY || "durable-llrt-integ";
const RUN_ID = process.env.GITHUB_RUN_ID || String(Date.now());
const FUNCTION_NAME_PREFIX = "durable-llrt-integ-";
const FUNCTION_NAME = `${FUNCTION_NAME_PREFIX}${RUN_ID}`;

/**
 * Container CLI. Docker on the hosted runners; `CONTAINER_CLI=finch` covers a local run on a
 * machine without a Docker daemon.
 */
const CONTAINER_CLI = process.env.CONTAINER_CLI || "docker";

/**
 * Image and function architecture. Building for the host's architecture avoids emulation, which
 * is why this is detected rather than fixed: hosted runners are x64, Apple Silicon is arm64.
 * Lambda charges less for arm64 and LLRT publishes container binaries for both.
 */
const ARCH =
  process.env.LLRT_ARCH || (process.arch === "arm64" ? "arm64" : "x64");
const LAMBDA_ARCH = ARCH === "arm64" ? "arm64" : "x86_64";
const DOCKER_PLATFORM = ARCH === "arm64" ? "linux/arm64" : "linux/amd64";

const COLORS = {
  RED: "\x1b[0;31m",
  GREEN: "\x1b[0;32m",
  BLUE: "\x1b[0;34m",
  NC: "\x1b[0m",
};
const log = {
  info: (/** @type {string} */ m) =>
    console.log(`${COLORS.BLUE}[INFO]${COLORS.NC} ${m}`),
  pass: (/** @type {string} */ m) =>
    console.log(`${COLORS.GREEN}[PASS]${COLORS.NC} ${m}`),
  fail: (/** @type {string} */ m) =>
    console.error(`${COLORS.RED}[FAIL]${COLORS.NC} ${m}`),
};

/**
 * Runs a command, returning trimmed stdout when it was captured. Commands that inherit stdio
 * (the container build and push, whose progress output is worth seeing) return no string, so
 * callers of those ignore the result.
 */
const run = (
  /** @type {string} */ cmd,
  /** @type {string[]} */ args,
  /** @type {any} */ opts = {},
) => {
  const output = execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...opts,
  });
  return typeof output === "string" ? output.trim() : "";
};

const lambda = new LambdaClient({ region: REGION });

/**
 * Bundles the handler the way an LLRT user would: the runtime supplies the Node builtins and the
 * AWS SDK, so both stay external and the image needs no `node_modules`.
 *
 * `platform: "neutral"` rather than `"browser"`, which LLRT's own docs suggest: `browser` makes
 * esbuild honour the `browser` field in package.json, which could silently substitute a
 * browser-targeted build of a dependency into a server-side runtime. For this graph the two
 * produce byte-identical output, so `neutral` costs nothing and states the intent.
 *
 * `node:*` covers the prefixed specifiers; the short list below is only for the unprefixed ones
 * still in the graph. It cannot rot silently: under `neutral` esbuild does not treat builtins as
 * external implicitly, so a new unprefixed import that is missing here fails the build.
 */
async function bundleHandler() {
  const UNPREFIXED_BUILTINS = ["crypto", "events"];
  writeFileSync(
    join(WORK_DIR, "entry.mjs"),
    'export { handler } from "' +
      join(__dirname, "fixture/workflow.mjs") +
      '";\n',
  );
  await build({
    entryPoints: [join(WORK_DIR, "entry.mjs")],
    outfile: join(WORK_DIR, "handler.mjs"),
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2023",
    minify: true,
    external: ["@aws-sdk/*", "@smithy/*", "node:*", ...UNPREFIXED_BUILTINS],
    logLevel: "warning",
    absWorkingDir: REPO_ROOT,
  });
}

/**
 * SHA-256 of each `llrt-container-*-full-sdk` asset for {@link LLRT_VERSION}.
 *
 * The release is tagged `-beta` and tags are mutable, so the binary is verified rather than
 * trusted. If upstream re-tags, the build fails here instead of silently running something else.
 */
const LLRT_CHECKSUMS = {
  arm64: "7f0f2e50295ab2075c82267af62471d7360f905ed5eb4692eb9ad9778d6ba9fa",
  x64: "5a3795f06eee588da6601f12e7684f41ef3810637bb0bcdc1a3d974d5b4ef3b7",
};

/**
 * Fetches the LLRT binary and checks it against {@link LLRT_CHECKSUMS}, so the image is built
 * from a known artifact rather than from whatever the mutable tag points at during the build.
 */
async function fetchLlrtBinary() {
  const asset = `llrt-container-${ARCH}-full-sdk`;
  const url = `https://github.com/awslabs/llrt/releases/download/${LLRT_VERSION}/${asset}`;
  log.info(`downloading ${asset}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `download failed: ${response.status} ${response.statusText} for ${url}`,
    );
  }
  const binary = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(binary).digest("hex");
  const expected = LLRT_CHECKSUMS[ARCH];
  if (digest !== expected) {
    throw new Error(
      `checksum mismatch for ${asset}: expected ${expected}, got ${digest}. ` +
        "If upstream re-tagged the release, update LLRT_CHECKSUMS after reviewing the change.",
    );
  }
  writeFileSync(join(WORK_DIR, "llrt"), binary);
}

/**
 * The image carries no `node_modules`: the handler is bundled with `@aws-sdk` marked external,
 * so the `@aws-sdk/client-lambda` the SDK loads to call CheckpointDurableExecution resolves to
 * the copy compiled into the LLRT binary.
 *
 * TODO: the standard build should be enough and is ~1.7 MB smaller. Its `sdk.cfg` marks
 * `client-lambda` as not full-SDK-only (`client-lambda,Lambda,lambda,0`) and the standard binary
 * does resolve `CheckpointDurableExecutionCommand`, despite LLRT's README compatibility table
 * listing the client under full-sdk alone. Switching needs one real run to confirm.
 */
function writeDockerfile() {
  writeFileSync(
    join(WORK_DIR, "Dockerfile"),
    [
      `FROM --platform=${DOCKER_PLATFORM} busybox`,
      "WORKDIR /var/task/",
      "COPY handler.mjs ./",
      "COPY llrt /usr/bin/llrt",
      "RUN chmod +x /usr/bin/llrt",
      'ENV LAMBDA_HANDLER="handler.handler"',
      'CMD [ "llrt" ]',
      "",
    ].join("\n"),
  );
}

async function pushImage() {
  const accountId = run("aws", [
    "sts",
    "get-caller-identity",
    "--query",
    "Account",
    "--output",
    "text",
  ]);
  const registry = `${accountId}.dkr.ecr.${REGION}.amazonaws.com`;
  const imageUri = `${registry}/${ECR_REPO}:${RUN_ID}`;

  try {
    run("aws", [
      "ecr",
      "describe-repositories",
      "--repository-names",
      ECR_REPO,
      "--region",
      REGION,
    ]);
  } catch {
    log.info(`creating ECR repository ${ECR_REPO}`);
    run("aws", [
      "ecr",
      "create-repository",
      "--repository-name",
      ECR_REPO,
      "--region",
      REGION,
    ]);
    // Backstop for images this test does not get to delete itself, e.g. when a job is cancelled
    // between the push and the cleanup.
    run("aws", [
      "ecr",
      "put-lifecycle-policy",
      "--repository-name",
      ECR_REPO,
      "--region",
      REGION,
      "--lifecycle-policy-text",
      JSON.stringify({
        rules: [
          {
            rulePriority: 1,
            description: "Expire test images after a day",
            selection: {
              tagStatus: "any",
              countType: "sinceImagePushed",
              countUnit: "days",
              countNumber: 1,
            },
            action: { type: "expire" },
          },
        ],
      }),
    ]);
  }

  const password = run("aws", [
    "ecr",
    "get-login-password",
    "--region",
    REGION,
  ]);
  execFileSync(
    CONTAINER_CLI,
    ["login", "--username", "AWS", "--password-stdin", registry],
    {
      input: password,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );

  log.info(`building and pushing ${imageUri} (${DOCKER_PLATFORM})`);
  run(
    CONTAINER_CLI,
    ["build", "--platform", DOCKER_PLATFORM, "-t", imageUri, WORK_DIR],
    { stdio: "inherit" },
  );
  run(CONTAINER_CLI, ["push", imageUri], { stdio: "inherit" });
  return imageUri;
}

/**
 * Durable executions must be invoked against a qualified identifier, so a version is published
 * and the tests target that rather than $LATEST.
 */
async function deployFunction(/** @type {string} */ imageUri) {
  if (!ROLE_ARN) throw new Error("TEST_LAMBDA_EXECUTION_ROLE_ARN is not set");

  let exists = true;
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: FUNCTION_NAME }));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
    exists = false;
  }

  if (exists) {
    await lambda.send(
      new UpdateFunctionCodeCommand({
        FunctionName: FUNCTION_NAME,
        ImageUri: imageUri,
      }),
    );
  } else {
    await lambda.send(
      new CreateFunctionCommand({
        FunctionName: FUNCTION_NAME,
        PackageType: "Image",
        Code: { ImageUri: imageUri },
        Role: ROLE_ARN,
        Architectures: [LAMBDA_ARCH],
        MemorySize: 512,
        Timeout: 60,
        DurableConfig: { ExecutionTimeout: 3600, RetentionPeriodInDays: 1 },
      }),
    );
  }

  await waitUntilFunctionUpdatedV2(
    { client: lambda, maxWaitTime: 300 },
    { FunctionName: FUNCTION_NAME },
  );
  const published = await lambda.send(
    new PublishVersionCommand({ FunctionName: FUNCTION_NAME }),
  );
  return `${FUNCTION_NAME}:${published.Version}`;
}

const failures = [];
function check(
  /** @type {string} */ what,
  /** @type {boolean} */ ok,
  /** @type {string} */ detail = "",
) {
  if (ok) log.pass(what);
  else {
    log.fail(`${what}${detail ? ` — ${detail}` : ""}`);
    failures.push(what);
  }
}

/**
 * Echoes the function's own log records: the SDK's degraded-context warning (proof that the
 * fallback path, not Node's AsyncLocalStorage, is what ran) and Lambda's REPORT lines, whose
 * Init Duration is the number LLRT exists for. Best effort — logs are for diagnosis, so a
 * failure to read them must not fail the test.
 */
async function reportFunctionLogs() {
  const logGroup = `/aws/lambda/${FUNCTION_NAME}`;
  try {
    const logs = new CloudWatchLogsClient({ region: REGION });
    // Log delivery trails the invocation.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const streams = await logs.send(
      new DescribeLogStreamsCommand({
        logGroupName: logGroup,
        orderBy: "LastEventTime",
        descending: true,
        limit: 5,
      }),
    );
    for (const stream of streams.logStreams ?? []) {
      const events = await logs.send(
        new GetLogEventsCommand({
          logGroupName: logGroup,
          logStreamName: /** @type {string} */ (stream.logStreamName),
          startFromHead: true,
        }),
      );
      for (const event of events.events ?? []) {
        const message = (event.message ?? "").trim();
        if (/AsyncLocalStorage|REPORT RequestId|Init Duration/.test(message)) {
          log.info(`log: ${message.slice(0, 400)}`);
        }
      }
    }
  } catch (error) {
    log.info(`could not read ${logGroup}: ${error}`);
  }
}

/**
 * Removes this run's function and image.
 *
 * The image matters as much as the function: `pushImage` adds a tag per run, and without this the
 * repository would grow forever.
 */
async function cleanUp(imageUri) {
  log.info(`deleting ${FUNCTION_NAME}`);
  await lambda
    .send(new DeleteFunctionCommand({ FunctionName: FUNCTION_NAME }))
    .catch((error) => log.fail(`deleting the function failed: ${error}`));

  try {
    run("aws", [
      "ecr",
      "batch-delete-image",
      "--repository-name",
      ECR_REPO,
      "--region",
      REGION,
      "--image-ids",
      `imageTag=${imageUri.split(":").pop()}`,
    ]);
  } catch (error) {
    log.fail(`deleting the image failed: ${error}`);
  }
}

/**
 * Deletes functions left behind by earlier runs.
 *
 * A cancelled job never reaches its own cleanup, so without this each cancellation would leak a
 * function permanently. Anything older than an hour cannot belong to a run still in progress.
 */
async function sweepAbandonedFunctions() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  let marker;

  do {
    const page = await lambda.send(
      new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }),
    );
    marker = page.NextMarker;

    for (const fn of page.Functions ?? []) {
      const name = fn.FunctionName ?? "";
      if (!name.startsWith(FUNCTION_NAME_PREFIX) || name === FUNCTION_NAME)
        continue;
      if (fn.LastModified && Date.parse(fn.LastModified) > cutoff) continue;

      log.info(`sweeping abandoned function ${name}`);
      await lambda
        .send(new DeleteFunctionCommand({ FunctionName: name }))
        .catch((error) => log.fail(`sweeping ${name} failed: ${error}`));
    }
  } while (marker);
}

async function main() {
  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });

  await sweepAbandonedFunctions();

  await bundleHandler();
  await fetchLlrtBinary();
  writeDockerfile();
  const imageUri = await pushImage();
  const qualifiedName = await deployFunction(imageUri);
  log.info(`deployed ${qualifiedName}`);

  try {
    // Event (asynchronous) invocation, which is what a durable execution normally uses: Lambda
    // rejects a synchronous invoke when the configured ExecutionTimeout exceeds 15 minutes.
    const runner = new CloudDurableTestRunner({
      functionName: qualifiedName,
      client: lambda,
      config: { invocationType: "Event", pollInterval: 2000 },
    });
    const execution = await runner.run({ payload: { userId: "u-123" } });

    check(
      "execution succeeded",
      execution.getStatus() === "SUCCEEDED",
      String(execution.getStatus()),
    );
    const result = execution.getResult();
    check(
      "step results replayed correctly",
      result?.sum === 3,
      JSON.stringify(result),
    );
    check(
      "retry was recorded",
      result?.flaky?.attempts === 2,
      JSON.stringify(result?.flaky),
    );
    check(
      "wait suspended and resumed",
      execution.getInvocations().length > 1,
      `invocations=${execution.getInvocations().length}`,
    );

    log.info(
      `invocations=${execution.getInvocations().length} ` +
        `operations=${execution.getOperations().length} result=${JSON.stringify(result)}`,
    );
    await reportFunctionLogs();
  } finally {
    await cleanUp(imageUri);
  }

  if (failures.length > 0) {
    log.fail(`${failures.length} check(s) failed`);
    process.exit(1);
  }
  log.pass("LLRT container cloud test passed");
}

main().catch((error) => {
  log.fail(String(error?.stack ?? error));
  process.exit(1);
});
