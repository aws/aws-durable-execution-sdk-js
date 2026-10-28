// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Chained invoke with child suspension for OTel view case 27. */

import {
  createScenarioHandler,
  createTargetHandler,
  ScenarioEvent,
} from "./common";

export const handler = createScenarioHandler(
  "chained-invoke-suspend",
  async (event, context) =>
    context.invoke<ScenarioEvent, ScenarioEvent>(
      "otel-suspended-invoke",
      requiredTargetFunction(),
      event,
    ),
);

export const targetHandler = createTargetHandler(
  async (event: ScenarioEvent, context) => {
    await context.wait("otel-suspended-target-wait", {
      seconds: 1,
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
