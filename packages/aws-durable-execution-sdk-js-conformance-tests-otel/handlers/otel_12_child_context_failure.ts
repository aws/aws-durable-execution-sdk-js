// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0
/** Failed child-context scenario for OTel requirement otel-invocation-12. */

import { createScenarioHandler } from "./common";

export const handler = createScenarioHandler(
  "child-context-failure",
  async (_event, context) =>
    context.runInChildContext("otel-failed-child-context", async () => {
      throw new Error("Intentional child-context failure");
    }),
);
