// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Failed chained-invoke scenario for OTel requirement otel-invocation-18. */

import { createScenarioHandler, createTargetHandler } from "./common";

export const handler = createScenarioHandler(
  "chained-invoke-failure",
  async (event, context) =>
    context.invoke("otel-failed-invoke", requiredTargetFunction(), event),
);

export const targetHandler = createTargetHandler(async () => {
  throw new Error("Intentional chained-invoke target failure");
});

function requiredTargetFunction(): string {
  const functionName = process.env.OTEL_INVOKE_TARGET_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("OTEL_INVOKE_TARGET_FUNCTION_NAME is required");
  }
  return functionName;
}
