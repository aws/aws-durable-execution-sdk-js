// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Chained-invoke scenario for OTel requirement otel-invocation-11. */

import {
  createScenarioHandler,
  createTargetHandler,
  ScenarioEvent,
} from "./common";

export const handler = createScenarioHandler(
  "chained-invoke",
  async (event, context) =>
    context.invoke<ScenarioEvent, ScenarioEvent>(
      "otel-invoke",
      requiredTargetFunction(),
      event,
    ),
);

export const targetHandler = createTargetHandler(
  async (event: ScenarioEvent) => event,
);

function requiredTargetFunction(): string {
  const functionName = process.env.OTEL_INVOKE_TARGET_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("OTEL_INVOKE_TARGET_FUNCTION_NAME is required");
  }
  return functionName;
}
