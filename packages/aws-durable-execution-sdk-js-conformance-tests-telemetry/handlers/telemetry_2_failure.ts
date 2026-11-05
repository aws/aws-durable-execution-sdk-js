// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Single-step failure workflow exported by Durable Execution Telemetry for requirement telemetry-2. */

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

/**
 * The step fails once with no retry. The handler rethrows with the step error
 * as `cause`. So the exported record carries an `error` on the execution and
 * on `operationsByName.charge`. Error names and cause depth differ per SDK by
 * design, so telemetry-2 asserts only that each error is an object. The
 * messages "card declined" and "payment failed" are pinned by its core
 * execution-result and history sections. Do not change them.
 */
export const handler = withDurableExecution(
  async (_event: Event, context) => {
    try {
      await context.step(
        "charge",
        async () => {
          throw new Error("card declined");
        },
        { retryStrategy: () => ({ shouldRetry: false }) },
      );
    } catch (error) {
      throw new Error("payment failed", { cause: error });
    }
  },
  { plugins: [pluginFactory] },
);
