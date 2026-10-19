// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { LambdaClient, InvokeCommandInput } from "@aws-sdk/client-lambda";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

const execute = promisify(execFile);

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
        const marker = `example-${randomUUID()}`;
        markers.add(marker);
        input.Payload = wrapLmiPayload(input.Payload, example, marker, run);
        input.DurableExecutionName = marker;
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
