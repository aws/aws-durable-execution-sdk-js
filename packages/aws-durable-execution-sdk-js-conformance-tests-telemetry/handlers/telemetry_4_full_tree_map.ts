// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/**
 * Map workflow exported with full-tree operation detail, for requirement
 * telemetry-4.
 */

import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
  CloudWatchLogsExporter,
  durableExecutionTelemetry,
} from "@aws/durable-execution-sdk-js-telemetry-exporter";

const logGroupName = process.env.TELEMETRY_LOG_GROUP_NAME;
if (!logGroupName) {
  throw new Error("TELEMETRY_LOG_GROUP_NAME must be set");
}

// One factory per module load, as in telemetry-1. `full-tree` makes the
// record include the operations nested inside each map iteration.
const pluginFactory = durableExecutionTelemetry({
  exporters: [new CloudWatchLogsExporter({ logGroupName })],
  emitMode: "on-complete",
  samplingRate: 1,
  operationDetail: "full-tree",
  content: { input: true, output: true },
});

export const handler = withDurableExecution(
  async (event: number[], context) => {
    const results = await context.map(
      "process-items",
      event,
      async (ctx, item) =>
        ctx.step(`greet-${item}`, async () => `Hello, ${item}!`),
      { maxConcurrency: 1, itemNamer: (item) => `item-${item}` },
    );
    return results.getResults();
  },
  { plugins: [pluginFactory] },
);
