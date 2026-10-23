// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Single-step success workflow exported by Durable Execution Telemetry for requirement telemetry-1. */

import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
  CloudWatchLogsExporter,
  durableExecutionTelemetry,
} from "@aws/durable-execution-sdk-js-telemetry-exporter";

interface Event {
  value: number;
}

const logGroupName = process.env.TELEMETRY_LOG_GROUP_NAME;
if (!logGroupName) {
  throw new Error("TELEMETRY_LOG_GROUP_NAME must be set");
}

// One factory per module load. The SDK calls its createPlugin once per
// invocation. The handler constructs no record and calls no exporter method.
// Delivery relies on the plugin's wrapInvocation drain, so a missing record is
// the plugin's defect, not the handler's.
const pluginFactory = durableExecutionTelemetry({
  exporters: [new CloudWatchLogsExporter({ logGroupName })],
  emitMode: "on-complete",
  samplingRate: 1,
  operationDetail: "top-level",
  content: { input: true, output: true },
});

export const handler = withDurableExecution(
  async (event: Event, context) => {
    const value = await context.step("increment", async () => event.value + 1);
    return { value };
  },
  { plugins: [pluginFactory] },
);
