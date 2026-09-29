// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { LambdaClient, InvokeCommandInput } from "@aws-sdk/client-lambda";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
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
    async after() {
      if (!markers.size) return;
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
      } catch (error) {
        // The subprocess may fail before its own quarantine handler runs, or be
        // killed by this timeout. Block later suites in either case.
        writeFileSync(
          quarantine,
          JSON.stringify({ error: String(error), markers: [...markers] }),
        );
        throw error;
      }
      markers.clear();
    },
  };
}
