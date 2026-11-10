// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/**
 * Single-step success workflow whose telemetry record carries one selected key
 * of the step result, for requirement telemetry-3.
 */

import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
  CloudWatchLogsExporter,
  durableExecutionTelemetry,
} from "@aws/durable-execution-sdk-js-telemetry-exporter";

interface Event {
  userId: string;
}

interface User {
  userId: string;
  email: string;
  token: string;
}

const logGroupName = process.env.TELEMETRY_LOG_GROUP_NAME;
if (!logGroupName) {
  throw new Error("TELEMETRY_LOG_GROUP_NAME must be set");
}

// One factory per module load, as in telemetry-1. Execution input and output
// are disabled so the full step result can reach the record only through the
// operation result. The override opts the `fetch-user` result in and keeps one
// key. The transform receives the checkpointed result as a plain JSON object;
// it reads `userId` directly and unwraps nothing. If the plugin handed it a
// serialization envelope, `userId` would be undefined and the record would
// fail the requirement's exact match.
const pluginFactory = durableExecutionTelemetry({
  exporters: [new CloudWatchLogsExporter({ logGroupName })],
  emitMode: "on-complete",
  samplingRate: 1,
  operationDetail: "top-level",
  content: {
    input: false,
    output: false,
    operations: {
      overrides: [
        {
          operationName: "fetch-user",
          result: (result) => ({
            userId: (result as { userId: string }).userId,
          }),
        },
      ],
    },
  },
});

export const handler = withDurableExecution(
  async (event: Event, context) => {
    const user = await context.step(
      "fetch-user",
      async (): Promise<User> => ({
        userId: event.userId,
        email: "test@example.com",
        token: "tok-456",
      }),
    );
    // Returned unchanged: the execution result must carry all three keys so
    // the run shows that telemetry filtering does not alter the workflow value.
    return user;
  },
  { plugins: [pluginFactory] },
);
