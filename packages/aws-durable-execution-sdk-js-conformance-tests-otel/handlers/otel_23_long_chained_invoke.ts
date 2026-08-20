// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Long chained invoke for OTel requirement otel-long-running-4. */

import {
  createScenarioHandler,
  createTargetHandler,
  longDelaySeconds,
  ScenarioEvent,
} from "./common";

export const handler = createScenarioHandler(
  "long-chained-invoke",
  async (event, context) =>
    context.invoke<ScenarioEvent, ScenarioEvent>(
      "otel-long-invoke",
      requiredTargetFunction(),
      event,
    ),
);

export const targetHandler = createTargetHandler(
  async (event: ScenarioEvent, context) => {
    await context.wait("otel-long-invoke-target-wait", {
      seconds: longDelaySeconds(event),
    });
    return event;
  },
);

function requiredTargetFunction(): string {
  const functionName = process.env.OTEL_INVOKE_TARGET_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("OTEL_INVOKE_TARGET_FUNCTION_NAME is required");
  }
  return functionName;
}
