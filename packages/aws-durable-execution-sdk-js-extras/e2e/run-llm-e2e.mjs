#!/usr/bin/env node
// End-to-end test for the llm operations.
//
//   node e2e/run-llm-e2e.mjs deploy   Deploys a durable function that runs ask
//                                     against Amazon Bedrock, invokes it, and
//                                     checks the result and the execution
//                                     history. The function has no decision
//                                     model, so it also checks that check
//                                     rejects.
//   node e2e/run-llm-e2e.mjs cleanup  Deletes the function and its role.
//
// The decision operations run against a live decision model server in the
// local test runner: see src/llm/__tests__/live.test.ts.
//
// Every resource is named with the "dex-llm-e2e" prefix.
// Prerequisites: AWS CLI v2 credentials for the target account, and a built
// workspace (npm run build in the SDK and extras packages).

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "build-llm");
const REGION = process.env.AWS_REGION ?? "us-east-1";
const PREFIX = "dex-llm-e2e";
const MODEL = "global.anthropic.claude-haiku-5-5";
const log = (message) =>
  console.log(`[${new Date().toISOString()}] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

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

function ensureRole(account) {
  const name = `${PREFIX}-function`;
  let role = aws(["iam", "get-role", "--role-name", name], {
    allowFailure: true,
  });
  let created = false;
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
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["bedrock:InvokeModel"],
            Resource: [
              "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5",
              `arn:aws:bedrock:*:${account}:inference-profile/${MODEL}`,
            ],
          },
        ],
      }),
    ],
    { json: false },
  );
  aws(
    [
      "iam",
      "attach-role-policy",
      "--role-name",
      name,
      "--policy-arn",
      "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy",
    ],
    { json: false },
  );
  if (created) {
    // A new role takes a few seconds to propagate.
    return sleep(15_000).then(() => role.Role.Arn);
  }
  return Promise.resolve(role.Role.Arn);
}

async function bundle() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "function"), { recursive: true });
  await build({
    entryPoints: [join(HERE, "llm-function.ts")],
    outfile: join(OUT, "function", "index.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    logLevel: "warning",
  });
  execFileSync("zip", [
    "-qj",
    join(OUT, "function.zip"),
    join(OUT, "function", "index.js"),
  ]);
}

async function deploy() {
  const account = aws(["sts", "get-caller-identity"]).Account;
  await bundle();
  const roleArn = await ensureRole(account);
  const name = `${PREFIX}-fn`;
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
      roleArn,
      "--timeout",
      "120",
      "--memory-size",
      "512",
      "--durable-config",
      JSON.stringify({ ExecutionTimeout: 600, RetentionPeriodInDays: 1 }),
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
  }
  const version = aws(["lambda", "publish-version", "--function-name", name]);
  const functionArn = version.FunctionArn;
  log(`published ${functionArn}`);

  const executionName = `llm-${Date.now()}`;
  const payloadFile = join(OUT, "payload.json");
  writeFileSync(
    payloadFile,
    JSON.stringify({
      body: "Help! My payouts have been failing for 3 days and nobody answers.",
    }),
  );
  const invoked = aws([
    "lambda",
    "invoke",
    "--function-name",
    functionArn,
    "--invocation-type",
    "Event",
    "--durable-execution-name",
    executionName,
    "--cli-binary-format",
    "raw-in-base64-out",
    "--payload",
    `fileb://${payloadFile}`,
    join(OUT, "out.json"),
  ]);
  const executionArn = invoked.DurableExecutionArn;
  assert(executionArn, `no execution ARN: ${JSON.stringify(invoked)}`);
  log(`started ${executionArn}`);

  let execution;
  for (let i = 0; i < 120; i++) {
    execution = aws([
      "lambda",
      "get-durable-execution",
      "--durable-execution-arn",
      executionArn,
    ]);
    if (execution.Status !== "RUNNING") {
      break;
    }
    await sleep(3_000);
  }
  console.log(JSON.stringify(execution, null, 2));
  assert(execution.Status === "SUCCEEDED", `status ${execution.Status}`);

  const result = JSON.parse(execution.Result);
  assert(result.checkError === "TypeError", `check gave ${result.checkError}`);
  for (const field of ["summary", "team"]) {
    assert(
      typeof result[field] === "string" && result[field].length > 0,
      `no ${field}`,
    );
  }

  const history = aws([
    "lambda",
    "get-durable-execution-history",
    "--durable-execution-arn",
    executionArn,
    "--include-execution-data",
  ]);
  const events = history.Events ?? [];
  const subTypes = Object.fromEntries(
    events.filter((e) => e.Name).map((e) => [e.Name, e.SubType]),
  );
  console.log(JSON.stringify(subTypes));
  assert(
    subTypes["llm.ask"] === "LlmAsk" && subTypes["llm.ask.team"] === "LlmAsk",
    `subtypes ${JSON.stringify(subTypes)}`,
  );
  assert(!("llm.check" in subTypes), "check created a durable operation");
  // The wait made the handler replay. Each step still ran once.
  for (const stepName of ["llm.ask", "llm.ask.team"]) {
    const started = events.filter(
      (e) => e.Name === stepName && e.EventType === "StepStarted",
    ).length;
    assert(started === 1, `${stepName} started ${started} times`);
  }
  log("DEPLOYED TEST PASSED");
}

function cleanup() {
  aws(["lambda", "delete-function", "--function-name", `${PREFIX}-fn`], {
    allowFailure: true,
    json: false,
  });
  const role = `${PREFIX}-function`;
  aws(
    ["iam", "delete-role-policy", "--role-name", role, "--policy-name", "e2e"],
    { allowFailure: true, json: false },
  );
  aws(
    [
      "iam",
      "detach-role-policy",
      "--role-name",
      role,
      "--policy-arn",
      "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy",
    ],
    { allowFailure: true, json: false },
  );
  aws(["iam", "delete-role", "--role-name", role], {
    allowFailure: true,
    json: false,
  });
  log("cleaned up");
}

const mode = process.argv[2];
if (mode === "deploy") {
  await deploy();
} else if (mode === "cleanup") {
  cleanup();
} else {
  console.error("usage: run-llm-e2e.mjs deploy|cleanup");
  process.exit(2);
}
