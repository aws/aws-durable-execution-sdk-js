// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  LambdaClient,
  InvokeCommandInput,
  InvokeCommandOutput,
} from "@aws-sdk/client-lambda";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

function saveInvocation(directory: string, marker: string, record: unknown) {
  mkdirSync(directory, { recursive: true });
  const target = join(directory, `${marker}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(record));
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function wrapLmiPayload(
  payload: InvokeCommandInput["Payload"],
  name: string,
  marker: string,
  run: string,
): Uint8Array {
  let original = "{}";
  if (typeof payload === "string") original = payload;
  else if (payload instanceof ArrayBuffer)
    original = Buffer.from(payload).toString("utf8");
  else if (ArrayBuffer.isView(payload))
    original = Buffer.from(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength,
    ).toString("utf8");
  else if (payload !== undefined)
    throw new Error("Unsupported shared LMI payload type");
  return Buffer.from(
    JSON.stringify({
      __lmiExample: { name, marker, run },
      input: JSON.parse(original),
    }),
  );
}

export function sharedLmi(client: LambdaClient, example: string) {
  if (!process.env.LMI_SHARED_EXAMPLES) return undefined;
  const run = process.env.LMI_RUN_ID;
  const script = process.env.LMI_CONTROL_SCRIPT;
  const root = process.env.LMI_REPO_ROOT;
  const quarantine = process.env.LMI_QUARANTINE_FILE;
  if (!run || !script || !root || !quarantine)
    throw new Error("Shared LMI configuration is incomplete");
  const manifest = JSON.parse(
    readFileSync(join(dirname(quarantine), "manifest.json"), "utf8"),
  );
  const commit = manifest?.commit;
  const functionName = manifest?.functions?.shared;
  if (
    manifest?.run !== run ||
    typeof commit !== "string" ||
    !commit ||
    typeof functionName !== "string" ||
    !functionName
  )
    throw new Error("Shared LMI manifest does not identify this deployment");
  const records = join(dirname(quarantine), "invocations");
  const markers = new Set<string>();
  let settlement: Promise<void> | undefined;
  client.middlewareStack.add(
    (next, context) => async (args) => {
      if (context.commandName === "InvokeCommand") {
        if (existsSync(quarantine))
          throw new Error(
            "Shared LMI fixture is quarantined; later cases cannot run",
          );
        const input = args.input as InvokeCommandInput;
        if (input.FunctionName !== functionName)
          throw new Error("Shared LMI invocation targets a different function");
        const marker = `example-${randomUUID()}`;
        input.Payload = wrapLmiPayload(input.Payload, example, marker, run);
        input.DurableExecutionName = marker;
        const record = {
          marker,
          run,
          commit,
          scenario: `example:${example}`,
          fixture: "shared",
          gates: {},
          invoked: true,
        };
        // The driver may exit after Lambda accepts Invoke but before teardown
        // or its response arrives. Retain ownership before handing off to I/O.
        saveInvocation(records, marker, record);
        markers.add(marker);
        const result = await next(args);
        const output = result.output as InvokeCommandOutput;
        saveInvocation(records, marker, {
          ...record,
          arn: output.DurableExecutionArn,
          invokeRequestId: output.$metadata?.requestId,
        });
        return result;
      }
      return next(args);
    },
    { step: "initialize", name: "routeSharedLmiExample" },
  );
  return {
    before() {
      if (existsSync(quarantine))
        throw new Error(
          "Shared LMI fixture is quarantined; later cases cannot run",
        );
      markers.clear();
    },
    after() {
      // Jest still runs afterEach when a later beforeEach fails on quarantine.
      // Reuse pending cleanup so only one subprocess can reopen the fixture.
      if (settlement !== undefined) return settlement;
      if (!markers.size) return Promise.resolve();
      settlement = (async () => {
        // Jest can time out this hook before the subprocess settles. Block later
        // cases synchronously and reopen the fixture only after confirmed cleanup.
        writeFileSync(
          quarantine,
          JSON.stringify({ run, markers: [...markers], state: "settling" }),
        );
        try {
          await execute(
            process.env.LMI_PYTHON || "python",
            [script, "settle-case", "--markers", [...markers].join(",")],
            {
              cwd: root,
              env: process.env,
              timeout: 180000,
              maxBuffer: 1024 * 1024,
            },
          );
          unlinkSync(quarantine);
        } catch (error) {
          // The subprocess may fail before its own quarantine handler runs, or be
          // killed by this timeout. Keep later suites blocked in either case.
          writeFileSync(
            quarantine,
            JSON.stringify({
              run,
              markers: [...markers],
              error: String(error),
            }),
          );
          throw error;
        }
        markers.clear();
      })().finally(() => {
        settlement = undefined;
      });
      return settlement;
    },
  };
}
