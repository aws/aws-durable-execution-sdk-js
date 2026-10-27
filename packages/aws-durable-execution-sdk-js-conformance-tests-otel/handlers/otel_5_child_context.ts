// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Child-context hierarchy scenario for OTel requirement otel-invocation-5. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "child-context",
  async (_event, context) =>
    context.runInChildContext("otel-child-context", async (childContext) =>
      childContext.step("otel-child-step", async () => "child-complete"),
    ),
);
